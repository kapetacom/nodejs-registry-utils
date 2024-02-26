import { URL } from 'url';
import { PathLike, existsSync, readFileSync, writeFileSync, unlinkSync, renameSync } from 'fs';
import Config from '../../config';
import FSExtra from 'fs-extra';
import tar from 'tar';
import Path from 'node:path';
import { ArtifactHandler, NPMDetails, ProgressListener } from '../../types';
import { RegistryService } from '../../services/RegistryService';

export class NPMHandler implements ArtifactHandler {
    private _progressListener: ProgressListener;
    private _directory: string;
    private _accessToken: string;
    private _hostInfo: URL;

    constructor(progressListener: ProgressListener, directory: string, accessToken: string) {
        this._progressListener = progressListener;
        this._directory = directory;
        this._accessToken = accessToken;
        this._hostInfo = new URL(Config.data.registry.npm);
    }

    static getType(): string {
        return 'npm';
    }

    getName(): string {
        return 'NPM';
    }

    static isSupported(directory: string): boolean {
        return existsSync(Path.join(directory, 'package.json'));
    }

    static create(progressListener: ProgressListener, directory: string, accessToken: string): NPMHandler {
        return new NPMHandler(progressListener, directory, accessToken);
    }

    async verify(): Promise<void> {
        const cmd: string = process.platform === 'win32' ? 'where npm' : 'which npm';
        return this._progressListener.progress('Finding NPM executable', () =>
            this._progressListener.run(cmd, this._directory),
        );
    }

    async calculateChecksum(): Promise<string> {
        const result = await this._progressListener.progress('Calculating checksum', () =>
            this._progressListener.run('npm pack --dryrun --json', this._directory),
        );
        const packInfo = result?.output ? JSON.parse(result.output) : null;

        if (packInfo && packInfo.length > 0) {
            //Delete tmp file
            if (packInfo[0].filename) {
                const pathName = packInfo[0].filename.replace(/\//g, '-').replace(/^@/, '');
                if (existsSync(pathName)) {
                    unlinkSync(pathName);
                }
            }

            if (packInfo[0].integrity) {
                return packInfo[0].integrity;
            }

            if (packInfo[0].shasum) {
                return packInfo[0].shasum;
            }
        }

        return Promise.reject(new Error('Failed to get checksum using npm pack'));
    }

    async ensureCredentials(scope: string, registryUrl?: string): Promise<void> {
        const key: string = `//${this._hostInfo.host}/:_authToken`;

        this.makeNpmBackup();
        //Make sure this scope goes to the right registry

        if (!registryUrl) {
            registryUrl = this._hostInfo.href;
        }

        return this._progressListener.progress('Configuring NPM access', async () => {
            await this._progressListener.run(`echo '@${scope}:registry=${registryUrl}' >> .npmrc`);
            if (this._accessToken) {
                await this._progressListener.run(`npm config --location user set "${key}"="${this._accessToken}"`);
            } else {
                await this._progressListener.run(`npm config --location user set "${key}"=""`);
            }
        });
    }

    async versionExists(packageName: string, version: string): Promise<boolean> {
        try {
            const result = await this._progressListener.run(
                `npm view --registry ${this._hostInfo.href} ${packageName}@${version} version`,
            );
            return result.output.trim() === version;
        } catch (e) {
            //Ignore - OK if version doesnt exist
            return false;
        }
    }

    async push(name: string, version: string, commit: string): Promise<any> {
        const [scope] = name.split('/');
        await this.ensureCredentials(scope);
        let changedPackage: boolean = false;

        try {
            let packageInfo = this._getPackageInfo();
            const npmName: string = '@' + name;

            await this._progressListener.progress('Checking NPM registry', async () => {
                if (await this.versionExists(npmName, version)) {
                    throw new Error(`NPM version already exists [${npmName}:${version}] - can not be overwritten`);
                } else {
                    this._progressListener.info('NPM registry did not contain version. Proceeding...');
                }
            });

            if (packageInfo.name !== npmName || packageInfo.version !== version) {
                this.makePackageBackup();
                packageInfo.name = npmName;
                packageInfo.version = version;
                this._writePackageInfo(packageInfo);
                changedPackage = true;
            }

            await this._progressListener.progress(`Pushing NPM package: ${npmName}:${version}`, () =>
                this._progressListener.run(`npm publish --registry ${this._hostInfo.href}`, this._directory),
            );
        } finally {
            if (changedPackage) {
                this.restorePackageBackup();
            }

            this.restoreNpmBackup();
        }

        return {
            type: NPMHandler.getType(),
            details: {
                name: name,
                version: version,
                registry: this._hostInfo.href,
            },
        };
    }

    async pull(details: NPMDetails, target: string, registryService: RegistryService): Promise<void> {
        const [scope] = details.name.split('/');
        await this.ensureCredentials(scope, details.registry);
        try {
            await this._progressListener.progress(`Pulling NPM package: ${details.name}:${details.version}`, () =>
                this._progressListener.run(
                    `npm pack --registry ${details.registry} --pack-destination=${target} @${details.name}@${details.version}`,
                    this._directory,
                ),
            );
        } finally {
            this.restoreNpmBackup();
        }
    }

    async install(sourcePath: string, targetPath: string): Promise<void> {
        const files: string[] = await FSExtra.readdir(sourcePath);
        const tarFiles: string[] = files.filter((file) => /.tgz$/.test(file));

        if (tarFiles.length !== 1) {
            throw new Error('Invalid kapeta asset');
        }

        if (await FSExtra.exists(targetPath)) {
            await FSExtra.remove(targetPath);
        }

        await FSExtra.mkdirp(targetPath);

        const absolutePath: string = Path.join(sourcePath, tarFiles[0]);
        await this._progressListener.info(`Extracting tar file: ${absolutePath} to ${targetPath}`);
        await tar.extract({
            file: absolutePath,
            cwd: targetPath,
            strip: 1, //Needed since we've got a random root directory we want to ignore
        });

        await this._progressListener.info(`Tar file extracted`);

        process.env.NODE_ENV = 'production';

        const packageJsonRaw: Buffer = await FSExtra.readFile(Path.join(targetPath, 'package.json'));
        const packageJson: any = JSON.parse(packageJsonRaw.toString());

        if (!packageJson.bundledDependencies && !packageJson.bundleDependencies) {
            //Install npm dependencies if they're not bundled
            await this._progressListener.run('npm install --omit=dev', targetPath);
        }
    }

    private _getPackageInfo(): any {
        const packageJson: string = readFileSync(Path.join(this._directory, 'package.json')).toString();
        return JSON.parse(packageJson);
    }

    private makePackageBackup(): void {
        this.makeBackup('package.json');
        this.makeBackup('package-lock.json');
    }

    private makeNpmBackup(): void {
        this.makeBackup('.npmrc');
    }

    private makeBackup(file: string): void {
        const originalFile: PathLike = Path.join(this._directory, file);
        const backupFile: PathLike = Path.join(this._directory, file + '.original');
        if (existsSync(backupFile)) {
            unlinkSync(backupFile);
        }
        if (existsSync(originalFile)) {
            FSExtra.copyFileSync(originalFile, backupFile);
        }
    }

    private restoreNpmBackup(): void {
        this.restoreBackup('.npmrc');
    }

    private restorePackageBackup(): void {
        this.restoreBackup('package.json');
        this.restoreBackup('package-lock.json');
    }

    private restoreBackup(file: string): void {
        const backupFile: PathLike = Path.join(this._directory, file + '.original');
        const originalFile: PathLike = Path.join(this._directory, file);
        if (existsSync(backupFile)) {
            unlinkSync(originalFile);
            renameSync(backupFile, Path.join(this._directory, file));
        } else {
            //Nothing to backup - get rid of file still
            unlinkSync(originalFile);
        }
    }

    private _writePackageInfo(packageJson: any): void {
        writeFileSync(Path.join(this._directory, 'package.json'), JSON.stringify(packageJson, null, 2));
    }

    async build(): Promise<void> {
        process.env.NODE_ENV = 'development';

        await this._progressListener.progress('Installing NPM package', () =>
            this._progressListener.run('npm install', this._directory),
        );

        let packageInfo = this._getPackageInfo();
        if ('build' in packageInfo.scripts) {
            return this._progressListener.progress('Building NPM package', () =>
                this._progressListener.run('npm run build', this._directory),
            );
        } else {
            return this._progressListener.warn('Not building using NPM - no build script found');
        }
    }

    async test(): Promise<void> {
        process.env.NODE_ENV = 'development';

        let packageInfo = this._getPackageInfo();
        if ('test' in packageInfo.scripts) {
            return this._progressListener.progress('Testing NPM package', () =>
                this._progressListener.run('npm run test', this._directory),
            );
        } else {
            return this._progressListener.warn('Not testing using NPM - no test script found');
        }
    }
}
