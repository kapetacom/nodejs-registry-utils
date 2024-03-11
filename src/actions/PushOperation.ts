/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */
import Path from 'path';
import FS from 'fs';
import YAML from 'yaml';
import Config from '../config';
import { RegistryService } from '../services/RegistryService';

import { parseKapetaUri } from '@kapeta/nodejs-utils';
import ClusterConfiguration from '@kapeta/local-cluster-config';
import * as glob from 'glob';
import { KapetaAPI } from '@kapeta/nodejs-api-client';
import { calculateVersionIncrement } from '../utils/version-utils';
import { Attachment, AttachmentContentFormat } from '@kapeta/schemas';
import { KAPETA_CONFIG_FILE, KAPETA_DOTENV_FILE, createAttachmentFromFile, setAttachment } from '@kapeta/config-mapper';

import {
    ArtifactHandler,
    AssetDefinition,
    AssetReference,
    AssetVersion,
    ProgressListener,
    PushCommandOptions,
    ReadmeData,
    ReferenceMap,
    Repository,
    Reservation,
    ReservationRequest,
    VCSHandler,
} from '../types';
import { getVCSHandler } from '../handlers/VCSHandler';
import { getArtifactHandler } from '../handlers/ArtifactHandler';

const LOCAL_VERSION_MAPPING_CACHE: { [key: string]: string } = {};

export class PushOperation {
    private readonly _progressListener: ProgressListener;
    private readonly _directory: string;
    private readonly options: PushCommandOptions;
    private _registryService: RegistryService;
    private _assetKind: string | null;
    private _baseKind: string | null;
    private assetDefinitions: AssetDefinition[] | null;
    private reservation: Reservation | null;
    private _vcsHandler: VCSHandler | null | boolean;
    private _artifactHandler: ArtifactHandler | null | boolean;

    public file: string;

    constructor(progressListener: ProgressListener, directory: string, options: PushCommandOptions) {
        this._progressListener = progressListener;

        this._registryService = new RegistryService(Config.data.registry.url, Config.data.registry.organisationId);

        this.file = Path.resolve(process.cwd(), directory, 'kapeta.yml');

        this._assetKind = null;

        this._baseKind = null;

        this._directory = Path.dirname(this.file);

        this.options = options;

        this.assetDefinitions = null;

        this.reservation = null;

        this._vcsHandler = false;

        this._artifactHandler = false;
    }

    async vcsHandler(): Promise<VCSHandler> {
        if (this._vcsHandler === false) {
            this._vcsHandler = await getVCSHandler(this._progressListener, this._directory);
            if (this._vcsHandler) {
                this._progressListener.showValue(`Identified version control system`, this._vcsHandler.getName());
            } else {
                await this._progressListener.check(`Identified version control system`, false);
            }
        }

        return this._vcsHandler as VCSHandler;
    }

    async artifactHandler(): Promise<ArtifactHandler> {
        if (this._artifactHandler === false) {
            const api = new KapetaAPI();
            const accessToken = await api.getAccessToken();
            const handler = (this._artifactHandler = await getArtifactHandler(
                this._progressListener,
                this._baseKind!,
                this._assetKind!,
                this._directory,
                accessToken!,
            ));
            if (handler) {
                this._progressListener.showValue(`Identified artifact type`, handler.getName());
                await this._progressListener.progress('Verifying artifact type handler', () => handler.verify());
            } else {
                await this._progressListener.check(`Identified artifact type`, false);
            }
        }

        return this._artifactHandler as ArtifactHandler;
    }

    async checkExists(): Promise<void> {
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

        this._assetKind = this.assetDefinitions[0].kind;

        this._baseKind = await this.resolveBaseKind();
    }

    async checkWorkingDirectory(): Promise<void> {
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

    async reserveVersions(reservationRequest: ReservationRequest): Promise<Reservation> {
        this.reservation = await this._registryService.reserveVersions(reservationRequest);
        if (!this.reservation) {
            throw new Error('Failed to reserve version - no reservation returned from registry. ');
        }
        return this.reservation;
    }

    async getLatestVersion(name: string): Promise<AssetVersion> {
        return this._registryService.getLatestVersion(name);
    }

    private _hasScript(file: string): boolean {
        const scriptPath = './scripts/' + file;
        return FS.existsSync(scriptPath);
    }

    private async _runScript(file: string): Promise<void> {
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

    async runTests(artifactHandler: ArtifactHandler): Promise<void> {
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

    findAssetsInPath(): { [key: string]: string } {
        const baseDir = Path.dirname(this.file);
        const assetFiles = glob.sync('*/**/kapeta.yml', { cwd: baseDir });
        const localAssets: { [key: string]: string } = {};
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

    async resolveBaseKind(): Promise<string> {
        if (!this._assetKind || this._assetKind.startsWith('core/')) {
            return this._assetKind!;
        }

        const uri = parseKapetaUri(this._assetKind);

        if (!uri.fullName || !uri.version) {
            throw new Error('Invalid asset kind: ' + this._assetKind + ' expected format: handle/name:version');
        }

        const asset = await this._registryService.getVersion(uri.fullName, uri.version);

        return asset.content.kind;
    }

    async checkDependencies(): Promise<void> {
        const localAssets = this.findAssetsInPath();
        await this._progressListener.progress(`Checking ${Object.keys(localAssets).length} dependencies`, async () => {
            const newAssets = [];

            if (this.assetDefinitions) {
                for (let assetDefinition of this.assetDefinitions) {
                    newAssets.push(await this._checkDependenciesFor(assetDefinition, localAssets));
                }
            }

            this.assetDefinitions = newAssets;
        });
    }

    private async _checkDependenciesFor(
        asset: AssetDefinition,
        localAssets: { [key: string]: string },
    ): Promise<AssetDefinition> {
        const dependencies = await this.resolveDependencies(asset);
        const dependencyChanges: ReferenceMap[] = [];
        for (let dependency of dependencies) {
            const dependencyUri = parseKapetaUri(dependency.name);
            if (dependencyUri.version !== 'local') {
                continue;
            }

            if (LOCAL_VERSION_MAPPING_CACHE[dependency.name]) {
                dependencyChanges.push({
                    from: dependency.name,
                    to: LOCAL_VERSION_MAPPING_CACHE[dependency.name],
                });
                continue;
            }

            const key = `${dependencyUri.handle}/${dependencyUri.name}`;
            let assetLocalPath: string;
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

        if (!this.options.dryRun && dependencyChanges.length > 0) {
            dependencyChanges.forEach((ref) => {
                LOCAL_VERSION_MAPPING_CACHE[ref.from] = ref.to;
            });
            return this.updateDependencies(asset, dependencyChanges);
        }

        return asset;
    }

    async runBuild(artifactHandler: ArtifactHandler): Promise<void> {
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

    async getCurrentVcsCommit(): Promise<string | null> {
        const handler = await this.vcsHandler();

        return handler.getLatestCommit(this._directory);
    }

    async calculateConventionalIncrement(assetName: string): Promise<'PATCH' | 'MINOR' | 'MAJOR' | 'NONE'> {
        const handler = await this.vcsHandler();
        const latestVersion = await this.getLatestVersion(assetName);

        if (!latestVersion?.repository?.commit) {
            return 'NONE';
        }

        const commits = await handler.getCommitsSince(this._directory, latestVersion.repository.commit);

        return calculateVersionIncrement(commits);
    }

    async calculateMinimumIncrement(): Promise<string> {
        let increment = 'NONE';
        if (this.assetDefinitions) {
            for (let asset of this.assetDefinitions) {
                const result = await this.calculateConventionalIncrement(asset.metadata.name);
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
        }

        if (increment !== 'NONE') {
            this._progressListener.info(`Calculated minimum increment from commit messages: ${increment}`);
        }

        return increment;
    }

    async commitReservation(reservation: Reservation, assetVersions: AssetVersion[]): Promise<void> {
        return await this._registryService.commitReservation(reservation.id, assetVersions);
    }

    async abortReservation(reservation: Reservation): Promise<void> {
        await this._registryService.abortReservation(reservation);
    }

    async resolveDependencies(asset: AssetDefinition): Promise<AssetReference[]> {
        return this._registryService.resolveDependencies(asset);
    }

    async updateDependencies(asset: AssetDefinition, dependencies: ReferenceMap[]): Promise<AssetDefinition> {
        return this._registryService.updateDependencies(asset, dependencies);
    }

    async getAttachments(): Promise<Attachment[]> {
        const files = [
            {
                filename: KAPETA_CONFIG_FILE,
                contentType: 'application/yaml',
            },
            {
                filename: KAPETA_DOTENV_FILE,
                contentType: 'text/plain+dotenv',
            },
        ];

        const attachments: Attachment[] = [];

        for (const file of files) {
            const path = Path.join(this._directory, file.filename);
            if (!FS.existsSync(path)) {
                continue;
            }
            const attachment = await createAttachmentFromFile(path, file.contentType, AttachmentContentFormat.Base64);
            this._progressListener.info(`Adding attachment: ${file.filename}`);
            attachments.push(attachment);
        }

        return attachments;
    }

    getReadmeData(): ReadmeData | null {
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

    async perform(): Promise<{ references: string[]; mainBranch: boolean }> {
        const vcsHandler = await this.vcsHandler();
        const dryRun = !!this.options.dryRun;

        await this._progressListener.progress('Verifying files exist', async () => this.checkExists());

        await this._progressListener.progress('Verifying working directory', async () => this.checkWorkingDirectory());

        const artifactHandler = await this.artifactHandler();

        const commit = vcsHandler ? await this.getCurrentVcsCommit() : null;

        let minimumIncrement = 'NONE';
        if (vcsHandler) {
            await this._progressListener.progress('Calculating conventional commit increment', async () => {
                minimumIncrement = await this.calculateMinimumIncrement();
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
                assets: this.assetDefinitions || [],
                mainBranch: main,
                branchName: branch,
                commit,
                checksum,
                minimumIncrement,
            }),
        );

        const existingVersions: AssetVersion[] = [];

        reservation.versions = reservation.versions.filter((version) => {
            if (version.exists) {
                existingVersions.push({
                    content: version.content,
                    version: version.version,
                });
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

        const assetVersions: AssetVersion[] = [];

        try {
            let commitId;
            let repository: Repository<any> | undefined = undefined;

            let vcsTags: string[] = [];

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
                            vcsTags.push(`v${version}-${assetDefinition.metadata.name}`);
                        }
                    } else if (reservation.versions.length === 1) {
                        vcsTags.push(`v${reservation.versions[0].version}`);
                    }
                }
            }

            this._progressListener.info(`Calculated checksum for artifact: ${checksum}`);

            const readme = this.getReadmeData();

            const attachments = await this.getAttachments();

            if (!dryRun) {
                for (let i = 0; i < reservation.versions.length; i++) {
                    const reservedVersion = reservation.versions[i];
                    const name = reservedVersion.content.metadata.name;
                    if (attachments) {
                        attachments.forEach((attachment) => setAttachment(reservedVersion.content, attachment));
                    }
                    const artifact = await artifactHandler.push(name, reservedVersion.version, commitId!);

                    const assetVersion: AssetVersion = {
                        version: reservedVersion.version,
                        content: reservedVersion.content,
                        current: true,
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

                    if (attachments) {
                        attachments.forEach((attachment) => setAttachment(reservedVersion.content, attachment));
                    }

                    const assetVersion: AssetVersion = {
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
