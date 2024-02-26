/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */

import YAML from 'yaml';
import Path from 'node:path';
import FS from 'node:fs';
import FSExtra from 'fs-extra';
import ClusterConfiguration from '@kapeta/local-cluster-config';
import * as glob from 'glob';
import { ProgressListener } from '../types';

function makeSymLink(directory: string, versionTarget: string): void {
    try {
        // use lstat to check if there is an existing symlink
        // throws if nothing is there, but returns file stats even for invalid links
        // we can't rely on fs.exists, since invalid symlinks return false
        if (FS.lstatSync(versionTarget)) {
            FSExtra.removeSync(versionTarget);
        }
    } catch (e) {}
    FSExtra.mkdirpSync(Path.dirname(versionTarget));
    FSExtra.createSymlinkSync(directory, versionTarget, 'junction');
}

export function link(progressListener: ProgressListener, source: string = process.cwd()): void {
    const resolvedPath = Path.resolve(source);

    const kapetaYmlFilePath = Path.join(resolvedPath, 'kapeta.yml');
    if (!FS.existsSync(kapetaYmlFilePath)) {
        throw new Error('Current working directory is not a valid kapeta asset. Expected a kapeta.yml file');
    }

    const assetInfos = YAML.parseAllDocuments(FS.readFileSync(kapetaYmlFilePath).toString()).map((doc) => doc.toJSON());

    if (assetInfos.length === 0) {
        throw new Error(`Failed to link asset, ${kapetaYmlFilePath} does not contain any assets`);
    }

    //If there are multiple assets in the kapeta.yml - we still just create 1 symlink since both will
    //otherwise be loaded twice
    const assetInfo = assetInfos[0];
    const [handle, name] = assetInfo.metadata.name.split('/');
    const target = ClusterConfiguration.getRepositoryAssetPath(handle, name, 'local');

    assetInfos.forEach((assetInfo) => {
        if (assetInfo.kind === 'core/plan') {
            //Asset is a plan - we need to link any locally defined assets as well
            const assetFiles = glob.sync('*/**/kapeta.yml', { cwd: resolvedPath, absolute: true });
            if (assetFiles.length > 0) {
                progressListener.info('Linking local plan asset');
                assetFiles.forEach((assetFile) => {
                    link(progressListener, Path.dirname(assetFile));
                });
            }
        }
        progressListener.info('Linked asset %s:local\n  %s --> %s', assetInfo.metadata.name, resolvedPath, target);
    });

    makeSymLink(resolvedPath, target);

    progressListener.check('Linking done', true);
}
