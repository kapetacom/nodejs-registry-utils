import * as fs from 'node:fs';
import * as path from 'node:path';
import * as YAML from 'yaml';
import * as fsExtra from 'fs-extra';
import { ArtifactHandler, ProgressListener, YAMLDetails } from '../../types';
import { RegistryService } from '../../services/RegistryService';

export class YAMLHandler implements ArtifactHandler {
    private _progressListener: ProgressListener;
    private _directory: string;

    constructor(progressListener: ProgressListener, directory: string, accessToken: string) {
        this._progressListener = progressListener;
        this._directory = directory;
    }

    static getType(): string {
        return 'yaml';
    }

    getName(): string {
        return 'YAML File';
    }

    static isSupported(): boolean {
        return true;
    }

    static create(progressListener: ProgressListener, directory: string, accessToken: string): YAMLHandler {
        return new YAMLHandler(progressListener, directory, accessToken);
    }

    async verify(): Promise<void> {}

    async calculateChecksum(): Promise<string> {
        return '';
    }

    async push(name: string, version: string, commit: string): Promise<any> {
        return {
            type: YAMLHandler.getType(),
            details: {
                name,
                version,
                commit,
            },
        };
    }

    async pull(details: YAMLDetails, target: string, registryService: RegistryService): Promise<void> {
        const version = await this._progressListener.progress(
            `Downloading YAML for ${details.name}:${details.version}`,
            () => registryService.getVersion(details.name, details.version),
        );

        const filename = `${details.name.replace(/\//g, '-')}-${details.version}.yaml`;
        const dest = path.join(target, filename);

        fs.writeFileSync(dest, YAML.stringify(version.content));

        this._progressListener.info(`Wrote YAML to ${dest}`);
    }

    async install(sourcePath: string, targetPath: string): Promise<void> {
        fsExtra.moveSync(sourcePath, targetPath, { overwrite: true });
    }

    async build(): Promise<void> {}

    async test(): Promise<void> {}
}
