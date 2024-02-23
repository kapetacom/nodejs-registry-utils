/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */

const Path = require('path');
const FS = require('fs');
const YAML = require('yaml');

const RegistryService = require('../services/RegistryService');
const ArtifactHandler = require('../handlers/ArtifactHandler');
const VCSHandler = require('../handlers/VCSHandler');
const Config = require('../config');

const { parseKapetaUri } = require('@kapeta/nodejs-utils');
const ClusterConfiguration = require('@kapeta/local-cluster-config').default;
const glob = require('glob');
const { KapetaAPI } = require('@kapeta/nodejs-api-client');
const { calculateVersionIncrement } = require('../utils/version-utils');

const LOCAL_VERSION_MAPPING_CACHE = {};

class PushOperation {
    /**
     *
     * @param {ProgressListener} progressListener
     * @param {string} directory
     * @param {PushCommandOptions} options
     */
    constructor(progressListener, directory, options) {
        /**
         *
         * @type {ProgressListener}
         * @private
         */
        this._progressListener = progressListener;

        this._registryService = new RegistryService(Config.data.registry.url, Config.data.registry.organisationId);

        /**
         * @type {string}
         */
        this.file = Path.resolve(process.cwd(), directory, 'kapeta.yml');

        /**
         * @type {string|null}
         */
        this._assetKind = null;

        /**
         *
         * @type {string}
         */
        this._directory = Path.dirname(this.file);

        /**
         *
         * @type {PushCommandOptions}
         */
        this.options = options;

        /**
         *
         * @type {AssetDefinition[]|null}
         */
        this.assetDefinitions = null;

        /**
         *
         * @type {Reservation|null}
         */
        this.reservation = null;

        /**
         *
         * @type {VCSHandler|null|boolean}
         * @private
         */
        this._vcsHandler = false;

        /**
         *
         * @type {ArtifactHandler|null|boolean}
         * @private
         */
        this._artifactHandler = false;
    }

    /**
     *
     * @returns {Promise<VCSHandler>}
     * @private
     */
    async vcsHandler() {
        if (this._vcsHandler === false) {
            this._vcsHandler = await VCSHandler.getVCSHandler(this._progressListener, this._directory);
            if (this._vcsHandler) {
                this._progressListener.showValue(`Identified version control system`, this._vcsHandler.getName());
            } else {
                await this._progressListener.check(`Identified version control system`, false);
            }
        }

        return this._vcsHandler;
    }

    /**
     *
     * @returns {Promise<ArtifactHandler>}
     * @private
     */
    async artifactHandler() {
        if (this._artifactHandler === false) {
            const api = new KapetaAPI();
            const accessToken = await api.getAccessToken();
            this._artifactHandler = await ArtifactHandler.getArtifactHandler(
                this._progressListener,
                this._assetKind,
                this._directory,
                accessToken,
            );
            if (this._artifactHandler) {
                this._progressListener.showValue(`Identified artifact type`, this._artifactHandler.getName());
                await this._progressListener.progress('Verifying artifact type handler', () =>
                    this._artifactHandler.verify(),
                );
            } else {
                await this._progressListener.check(`Identified artifact type`, false);
            }
        }

        return this._artifactHandler;
    }

    async checkExists() {
        //Check for kapeta.yml file

        const blockYml = Path.basename(this.file);

        if (!(await this._progressListener.check(blockYml + ' exists', FS.existsSync(this.file)))) {
            throw new Error(`${this.file} was not found`);
        }

        const fileStat = FS.statSync(this.file);

        if (!(await this._progressListener.check(blockYml + ' is file', fileStat.isFile()))) {
            throw new Error(`${this.file} is not a file. A valid file must be specified`);
        }

        const content = FS.readFileSync(this.file).toString();

        this.assetDefinitions = YAML.parseAllDocuments(content).map((doc) => doc.toJSON());

        this.assetDefinitions.forEach((assetDefinition) => {
            if (!assetDefinition.metadata) {
                throw new Error(`${this.file} is missing metadata. A valid block definition file must be specified`);
            }

            if (!assetDefinition.metadata.name) {
                throw new Error(
                    `${this.file} is missing metadata.name. A valid block definition file must be specified`,
                );
            }
        });

        // We only support 1 asset per file for now
        this._assetKind = this.assetDefinitions[0].kind;
    }

    async checkWorkingDirectory() {
        const handler = await this.vcsHandler();
        if (handler) {
            if (!this.options.ignoreWorkingDirectory) {
                await this._progressListener.progress('Checking that working directory is clean', async () => {
                    if (!(await handler.isWorkingDirectoryClean(this._directory))) {
                        throw new Error(
                            'Working directory is not clean. Make sure everything is committed or use --ignore-working-directory to ignore',
                        );
                    }
                });

                await this._progressListener.progress(
                    'Checking that working directory is up to date with remote',
                    async () => {
                        if (!(await handler.isWorkingDirectoryUpToDate(this._directory))) {
                            throw new Error(
                                'Working directory is not up to date with remote. Pull the latest changes or use --ignore-working-directory to continue.',
                            );
                        }
                    },
                );
            }
        }
    }

    /**
     *
     * @param {ReservationRequest} reservationRequest
     * @returns {Promise<Reservation>}
     */
    async reserveVersions(reservationRequest) {
        this.reservation = await this._registryService.reserveVersions(reservationRequest);
        if (!this.reservation) {
            throw new Error('Failed to reserve version - no reservation returned from registry. ');
        }
        return this.reservation;
    }

    /**
     *
     * @param {string} name
     * @returns {Promise<AssetVersion>}
     */
    async getLatestVersion(name) {
        return this._registryService.getLatestVersion(name);
    }

    _hasScript(file) {
        const scriptPath = './scripts/' + file;
        return FS.existsSync(scriptPath);
    }

    async _runScript(file) {
        const scriptPath = './scripts/' + file;
        if (!this._hasScript(file)) {
            throw new Error('Script not found: ' + scriptPath);
        }

        const stat = FS.statSync(scriptPath);
        if (!stat.isFile()) {
            throw new Error('Script not a file: ' + scriptPath);
        }

        return this._progressListener.run(scriptPath, this._directory);
    }

    /**
     *
     * @param {ArtifactHandler} artifactHandler
     * @returns {Promise<void>}
     */
    async runTests(artifactHandler) {
        if (this.options.skipTests) {
            this._progressListener.info('Skipping tests...');
            return;
        }

        try {
            await this._progressListener.progress('Running tests', async () => {
                if (this._hasScript('test.sh')) {
                    return this._runScript('test.sh');
                } else {
                    return artifactHandler.test();
                }
            });
        } catch (e) {
            throw new Error('Tests failed');
        }
    }

    findAssetsInPath() {
        const baseDir = Path.dirname(this.file);
        const assetFiles = glob.sync('*/**/kapeta.yml', { cwd: baseDir });
        const localAssets = {};
        for (let assetFile of assetFiles) {
            const fullPath = Path.join(baseDir, assetFile);
            const yamlData = FS.readFileSync(fullPath).toString();
            const assets = YAML.parseAllDocuments(yamlData).map((doc) => doc.toJSON());
            assets.forEach((asset) => {
                localAssets[asset.metadata.name] = Path.dirname(fullPath);
            });
        }

        return localAssets;
    }

    async checkAssetKindOfKind() {
        if (this._assetKind.startsWith('core/')) {
            return;
        }

        const uri = parseKapetaUri(this._assetKind);

        if (!uri.fullName || !uri.version) {
            throw new Error('Invalid asset kind: ' + this._assetKind + ' expected format: handle/name:version');
        }

        const asset = await this._registryService.getVersion(uri.fullName, uri.version);

        // We now know the "kind of the kind"
        this._assetKind = asset.content.kind;
    }

    async checkDependencies() {
        const localAssets = this.findAssetsInPath();
        await this._progressListener.progress(`Checking ${Object.keys(localAssets).length} dependencies`, async () => {
            const newAssets = [];

            for (let assetDefinition of this.assetDefinitions) {
                newAssets.push(await this._checkDependenciesFor(assetDefinition, localAssets));
            }

            //We overwrite assetDefinitions since we might have resolved some dependencies
            this.assetDefinitions = newAssets;
        });
    }

    /**
     *
     * @param {AssetDefinition} asset
     * @param {{[key:string]:string}} localAssets
     * @return {Promise<AssetDefinition>}
     * @private
     */
    async _checkDependenciesFor(asset, localAssets) {
        const dependencies = await this.resolveDependencies(asset);
        /**
         *
         * @type {ReferenceMap[]}
         */
        const dependencyChanges = [];
        for (let dependency of dependencies) {
            const dependencyUri = parseKapetaUri(dependency.name);
            if (dependencyUri.version !== 'local') {
                //If not local all is well
                continue;
            }

            if (LOCAL_VERSION_MAPPING_CACHE[dependency.name]) {
                //Mapping already found
                dependencyChanges.push({
                    from: dependency.name,
                    to: LOCAL_VERSION_MAPPING_CACHE[dependency.name],
                });
                continue;
            }

            const key = `${dependencyUri.handle}/${dependencyUri.name}`;
            let assetLocalPath;
            if (localAssets[key]) {
                assetLocalPath = localAssets[key];
                this._progressListener.info(`Resolved local version for ${key} from path: ${assetLocalPath}`);
            } else {
                const localPath = ClusterConfiguration.getRepositoryAssetPath(
                    dependencyUri.handle,
                    dependencyUri.name,
                    dependencyUri.version,
                );

                if (!FS.existsSync(localPath)) {
                    throw new Error('Path for local dependency not found: ' + localPath);
                }

                assetLocalPath = FS.realpathSync(localPath);

                if (!FS.existsSync(assetLocalPath)) {
                    throw new Error('Resolved path for local dependency not found: ' + localPath);
                }

                this._progressListener.info(
                    `Resolved local version for ${key} from local repository: ${assetLocalPath}`,
                );
            }

            //Local dependency - we need to push that first and
            //replace version with pushed version - but only "in-flight"
            //We dont want to change the disk version - since that allows users
            //to continue working on their local versions + local dependencies
            await this._progressListener.progress(`Pushing local version for ${key}`, async () => {
                const dependencyOperation = new PushOperation(this._progressListener, assetLocalPath, this.options);

                const { references } = await dependencyOperation.perform();

                if (references && references.length > 0) {
                    for (let reference of references) {
                        const referenceUri = parseKapetaUri(reference);
                        if (
                            referenceUri.handle === dependencyUri.handle &&
                            referenceUri.name === dependencyUri.name &&
                            referenceUri.version !== 'local'
                        ) {
                            this._progressListener.info(
                                'Resolved version for local dependency: %s > %s',
                                dependency.name,
                                referenceUri.version,
                            );
                            dependencyChanges.push({
                                from: dependency.name,
                                to: reference,
                            });
                        }
                    }
                }
            });
        }

        if (dependencyChanges.length > 0) {
            dependencyChanges.forEach((ref) => {
                //Cache mappings for other push operations and assets
                LOCAL_VERSION_MAPPING_CACHE[ref.from] = ref.to;
            });
            return this.updateDependencies(asset, dependencyChanges);
        }

        return asset;
    }

    /**
     *
     * @param {ArtifactHandler} artifactHandler
     * @returns {Promise<void>}
     */
    async runBuild(artifactHandler) {
        try {
            await this._progressListener.progress('Building block', async () => {
                if (this._hasScript('build.sh')) {
                    return this._runScript('build.sh');
                } else {
                    return artifactHandler.build();
                }
            });
        } catch (e) {
            throw e;
        }
    }

    /**
     *
     * @returns {Promise<string>} returns VCS commit id
     */
    async getCurrentVcsCommit() {
        const handler = await this.vcsHandler();

        return handler.getLatestCommit(this._directory);
    }

    /**
     *
     * @param {string} assetName - name of asset - e.g. my-handle/some-name
     * @returns {Promise<"PATCH"|"MINOR"|"MAJOR"|"NONE">}
     */
    async calculateConventionalIncrement(assetName) {
        const handler = await this.vcsHandler();
        const latestVersion = await this.getLatestVersion(assetName);

        if (!latestVersion?.repository?.commit) {
            //Latest version didn't exist or didn't have a commit. We can't calculate increment
            return 'NONE';
        }

        const commits = await handler.getCommitsSince(this._directory, latestVersion.repository.commit);

        return calculateVersionIncrement(commits);
    }

    /**
     *
     * @param {string} currentCommit current commit id
     * @returns {Promise<string>}
     */
    async calculateMinimumIncrement(currentCommit) {
        let increment = 'NONE';
        for (let asset of this.assetDefinitions) {
            const result = await this.calculateConventionalIncrement(asset.metadata.name, currentCommit);
            if (result === 'MAJOR') {
                increment = result;
                break;
            }
            if (result === 'MINOR') {
                increment = result;
            }

            if (result === 'PATCH' && increment === 'NONE') {
                increment = result;
            }
        }

        if (increment !== 'NONE') {
            this._progressListener.info(`Calculated minimum increment from commit messages: ${increment}`);
        }

        return increment;
    }

    /**
     *
     * @param {Reservation} reservation
     * @param {AssetVersion[]} assetVersions
     * @returns {Promise<void>}
     */
    async commitReservation(reservation, assetVersions) {
        return await this._registryService.commitReservation(reservation.id, assetVersions);
    }

    /**
     *
     * @param {Reservation} reservation
     * @returns {Promise<void>}
     */
    async abortReservation(reservation) {
        await this._registryService.abortReservation(reservation);
    }

    /**
     *
     * @param {AssetDefinition} asset
     * @return {Promise<AssetReference[]>}
     */
    async resolveDependencies(asset) {
        return this._registryService.resolveDependencies(asset);
    }

    /**
     *
     * @param {AssetDefinition} asset
     * @param {ReferenceMap[]} dependencies
     * @return {Promise<AssetDefinition>}
     */
    async updateDependencies(asset, dependencies) {
        return this._registryService.updateDependencies(asset, dependencies);
    }

    getReadmeData() {
        const paths = [
            {
                type: 'markdown',
                path: Path.join(this._directory, 'README.md'),
            },
            {
                type: 'text',
                path: Path.join(this._directory, 'README.txt'),
            },
            {
                type: 'text',
                path: Path.join(this._directory, 'README'),
            },
        ];

        for (let i = 0; i < paths.length; i++) {
            const pathInfo = paths[i];
            if (FS.existsSync(pathInfo.path)) {
                return {
                    type: pathInfo.type,
                    content: FS.readFileSync(pathInfo.path).toString(),
                };
            }
        }

        return null;
    }

    /**
     * Calls each check and step in the order it's intended.
     *
     * @returns {Promise<{references:string[],mainBranch:boolean}>}
     */
    async perform() {
        const vcsHandler = await this.vcsHandler();
        const dryRun = !!this.options.dryRun;

        //Make sure file structure is as expected
        await this._progressListener.progress('Verifying files exist', async () => this.checkExists());

        await this._progressListener.progress('Verifying working directory', async () => this.checkWorkingDirectory());

        await this.checkAssetKindOfKind();

        const artifactHandler = await this.artifactHandler();

        const commit = vcsHandler ? await this.getCurrentVcsCommit() : null;

        let minimumIncrement = 'NONE';
        if (vcsHandler && commit) {
            await this._progressListener.progress('Calculating conventional commit increment', async () => {
                minimumIncrement = await this.calculateMinimumIncrement(commit);
            });
        }

        await this.checkDependencies();

        await this.runBuild(artifactHandler);

        await this.runTests(artifactHandler);

        const { branch, main } = vcsHandler
            ? await vcsHandler.getBranch(this._directory)
            : { main: true, branch: 'master' };

        const checksum = await artifactHandler.calculateChecksum();

        const reservation = await this._progressListener.progress(`Create version reservation`, async () =>
            this.reserveVersions({
                assets: this.assetDefinitions,
                mainBranch: main,
                branchName: branch,
                commit,
                checksum,
                minimumIncrement,
            }),
        );

        const existingVersions = [];

        reservation.versions = reservation.versions.filter((version) => {
            if (version.exists) {
                existingVersions.push(version);
            }
            return !version.exists;
        });

        if (existingVersions.length > 0) {
            this._progressListener.info(`Version already existed remotely:`);
            existingVersions.forEach((v) => {
                this._progressListener.info(` - ${v.content.metadata.name}:${v.version}`);
            });
        }

        if (reservation.versions.length < 1) {
            this._progressListener.info(`No new versions found.`);
            return {
                references: existingVersions.map((assetVersion) => {
                    return `kapeta://${assetVersion.content.metadata.name}:${assetVersion.version}`;
                }),
                mainBranch: main,
            };
        }

        this._progressListener.info(`Got new versions: `);
        reservation.versions.forEach((v) => {
            this._progressListener.info(` - ${v.content.metadata.name}:${v.version}`);
        });

        /**
         * @type {AssetVersion[]}
         */
        const assetVersions = [];

        try {
            let commitId;
            /**
             * @type {Repository<any>}
             */
            let repository;

            /**
             * Tags for pushing when successful
             * @type {string[]}
             */
            let vcsTags = [];

            if (vcsHandler) {
                repository = {
                    type: vcsHandler.getType(),
                    details: await vcsHandler.getCheckoutInfo(this._directory),
                    commit,
                    branch,
                    main,
                };
                commitId = commit;
                if (main) {
                    this._progressListener.info(
                        `Assigning ${vcsHandler.getName()} commit id to version: ${commitId} > [${reservation.versions
                            .map((v) => v.version)
                            .join(', ')}]`,
                    );
                    if (reservation.versions.length > 1) {
                        for (let i = 0; i < reservation.versions.length; i++) {
                            const version = reservation.versions[i].version;
                            const assetDefinition = reservation.versions[i].content;
                            //Multiple assets in this repo - use separate tags for each
                            vcsTags.push(`v${version}-${assetDefinition.metadata.name}`);
                        }
                    } else if (reservation.versions.length === 1) {
                        //Only 1 asset in this repo - use simple version
                        vcsTags.push(`v${reservation.versions[0].version}`);
                    }
                }
            }

            this._progressListener.info(`Calculated checksum for artifact: ${checksum}`);

            const readme = this.getReadmeData();

            if (!dryRun) {
                for (let i = 0; i < reservation.versions.length; i++) {
                    const reservedVersion = reservation.versions[i];
                    const name = reservedVersion.content.metadata.name;

                    const artifact = await artifactHandler.push(name, reservedVersion.version, commitId);

                    /**
                     *
                     * @type {AssetVersion}
                     */
                    const assetVersion = {
                        version: reservedVersion.version,
                        content: reservedVersion.content,
                        current: true, // When creating a new version, it's always the new current version
                        checksum,
                        readme,
                        repository,
                        artifact,
                    };

                    assetVersions.push(assetVersion);
                }

                await this._progressListener.progress(
                    `Committing versions: ${assetVersions.map((av) => av.version)}`,
                    async () => this.commitReservation(reservation, assetVersions),
                );

                if (vcsHandler && vcsTags.length > 0) {
                    try {
                        await this._progressListener.progress('Tagging commit', async () => {
                            for (let i = 0; i < vcsTags.length; i++) {
                                await vcsHandler.tag(this._directory, vcsTags[i]);
                            }

                            await vcsHandler.pushTags(this._directory);
                        });
                    } catch (e) {
                        //Ignore errors for tagging
                    }
                }

                await this._progressListener.check(`Push completed`, true);
            } else {
                for (let i = 0; i < reservation.versions.length; i++) {
                    const reservedVersion = reservation.versions[i];
                    const name = reservedVersion.content.metadata.name;

                    /**
                     *
                     * @type {AssetVersion}
                     */
                    const assetVersion = {
                        version: reservedVersion.version,
                        content: reservedVersion.content,
                        checksum,
                        readme,
                        repository,
                        artifact: null,
                    };

                    assetVersions.push(assetVersion);
                    this._progressListener.info('Result:');
                    this._progressListener.info(YAML.stringify(assetVersions));
                }

                await this._progressListener.check(`Dry run completed`, true);
            }

            return {
                references: assetVersions.map((assetVersion) => {
                    return `kapeta://${assetVersion.content.metadata.name}:${assetVersion.version}`;
                }),
                mainBranch: main,
            };
        } catch (e) {
            await this._progressListener.progress('Aborting version', async () => this.abortReservation(reservation));
            throw e;
        }
    }
}

module.exports.PushOperation = PushOperation;
