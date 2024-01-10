/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */

const Path = require('node:path');
const OS = require('node:os');
const FS = require('node:fs');
const { parseKapetaUri } = require('@kapeta/nodejs-utils');

const YAML = require('yaml');
const FSExtra = require('fs-extra');
const ClusterConfiguration = require('@kapeta/local-cluster-config').default;
const RegistryService = require('../services/RegistryService');
const ArtifactHandler = require('../handlers/ArtifactHandler');
const Config = require('../config');
const { KapetaAPI } = require('@kapeta/nodejs-api-client');
const attemptedToInstall = {};

/**
 *
 * @param {ProgressListener} progressListener
 * @param {string[]} uris
 * @param {{registry?:string, skipDependencies?:boolean}} options
 * @return {Promise<*>}
 */
module.exports = async function install(progressListener, uris, options) {
    const allDependencies = {};
    const api = new KapetaAPI();
    const accessToken = await api.getAccessToken().catch(() => undefined);

    for (let i = 0; i < uris.length; i++) {
        const uri = uris[i];
        const assetInfo = parseKapetaUri(uri);

        try {
            const registryService = new RegistryService(options.registry || Config.data.registry.url, assetInfo.handle);

            const assetVersion = await progressListener.progress(`Loading ${uri}`, () =>
                registryService.getVersion(assetInfo.name, assetInfo.version)
            );

            if (!assetVersion) {
                throw new Error('Registration not found: ' + uri);
            }

            if (!assetVersion.artifact?.type) {
                throw new Error('Registration is missing artifact information: ' + uri);
            }

            const installPath = ClusterConfiguration.getRepositoryAssetPath(assetInfo.handle, assetInfo.name, assetVersion.version);

            const { versionFile: installVersion } =
                ClusterConfiguration.getRepositoryAssetInfoPath(assetInfo.handle, assetInfo.name, assetVersion.version);

            attemptedToInstall[`${assetInfo.handle}/${assetInfo.name}:${assetVersion.version}`] = true;

            const assetExists = await progressListener.progress('Checking if asset exists', () =>
                FSExtra.pathExists(installVersion)
            );
            if (assetExists) {
                await progressListener.check(`Asset already installed at ${installPath}`, true);
                continue;
            }

            const handler = ArtifactHandler.getArtifactHandlerByType(
                progressListener,
                assetVersion.artifact.type,
                accessToken
            );

            if (!handler) {
                throw new Error('Artifact type not found: ' + assetVersion.artifact.type);
            }

            const tmpFolder = Path.join(
                OS.tmpdir(),
                'blockctl-asset-install',
                assetInfo.handle,
                assetInfo.name,
                assetVersion.version
            );

            await progressListener.progress(
                `Pulling artifact using ${handler.getName()}`,
                async () => {
                    if (await FSExtra.pathExists(tmpFolder)) {
                        await FSExtra.remove(tmpFolder);
                    }

                    const tmpSourceFolder = Path.join(tmpFolder, 'source');
                    const tmpInstallFolder = Path.join(tmpFolder, 'install');
                    await FSExtra.mkdirp(tmpSourceFolder);
                    await FSExtra.mkdirp(tmpInstallFolder);

                    await progressListener.progress(
                        `Downloading...`,
                        () => handler.pull(assetVersion.artifact.details, tmpSourceFolder, registryService)
                    );

                    await progressListener.progress(
                        `Installing in ${tmpInstallFolder}...`,
                        () => handler.install(tmpSourceFolder, tmpInstallFolder)
                    );

                    const { assetFile, versionFile } = ClusterConfiguration.getRepositoryAssetInfoRelativePath(tmpInstallFolder);

                    const versionFolder = Path.dirname(versionFile);
                    progressListener.info(`Ensuring version folder: ${versionFolder}`);
                    await FSExtra.mkdirp(versionFolder);

                    //Write the asset file - it's usually included in the package but might contain multiple
                    await FSExtra.writeFile(assetFile, YAML.stringify(assetVersion.content));
                    progressListener.info(`Wrote asset information to ${assetFile}`);

                    //Write version information to file
                    await FSExtra.writeFile(versionFile, YAML.stringify(assetVersion));
                    progressListener.info(`Wrote version information to ${versionFile}`);

                    const installPathParent = Path.dirname(installPath);
                    progressListener.info(`Ensuring target parent folder: ${installPathParent}`);
                    await FSExtra.mkdirp(installPathParent);
                    await FSExtra.remove(installPath);

                    progressListener.info(`Moving ${tmpInstallFolder} to ${installPath}`);
                    await FSExtra.move(tmpInstallFolder, installPath);
                    progressListener.info(`Moved ${tmpInstallFolder} to ${installPath}`);
                }
            );

            assetVersion.dependencies.forEach((d) => {
                allDependencies[d.name] = true;
            });
        } catch (e) {
            console.error(e);
            progressListener.error(`Failed to install: ${e.stack}`);
        }
    }

    if (!options.skipDependencies) {
        const dependencies = Object.keys(allDependencies).filter((d) => !attemptedToInstall[d]);
        if (dependencies.length === 0) {
            progressListener.info('Done');
            return;
        }

        return progressListener.progress(`Installing ${dependencies.length} dependencies`, () =>
            install(progressListener, dependencies, options)
        );
    }

    await progressListener.check('Done installing', true);
};
