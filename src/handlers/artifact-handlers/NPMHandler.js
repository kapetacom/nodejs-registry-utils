const FS = require('node:fs');
const URL = require('node:url');
const Path = require('node:path');
const FSExtra = require('fs-extra');
const Config = require("../../config");
const tar = require('tar');
const {KapetaAPI} = require("@kapeta/nodejs-api-client");

/**
 * @class
 * @implements {ArtifactHandler}
 */
class NPMHandler {

    /**
     *
     * @param {ProgressListener} progressListener
     * @param {string} directory
     * @param {string} accessToken
     */
    constructor(progressListener, directory, accessToken) {
        this._progressListener = progressListener;
        this._directory = directory;
        this._accessToken = accessToken;
        this._hostInfo = URL.parse(Config.data.registry.npm);
    }

    static getType() {
        return "npm";
    }

    getName() {
        return "NPM";
    }

    static isSupported(directory) {
        return FS.existsSync(Path.join(directory, 'package.json'));
    }

    static create(progressListener, directory, accessToken) {
        return new NPMHandler(progressListener, directory, accessToken);
    }

    async verify() {
        const cmd = (process.platform === 'win32') ? 'where npm' : 'which npm';
        return await this._progressListener.progress('Finding NPM executable',
            () => this._progressListener.run(cmd, this._directory)
        );
    }

    async calculateChecksum() {
        const result = await this._progressListener.progress('Calculating checksum', () => this._progressListener.run('npm pack --dryrun --json', this._directory));
        const packInfo = result.output ? JSON.parse(result.output) : null;

        if (packInfo &&
            packInfo.length > 0) {
            //Delete tmp file
            if (packInfo[0].filename) {
                const pathName = packInfo[0].filename
                    .replace(/\//g, '-')
                    .replace(/^@/, '');
                if (FS.existsSync(pathName)) {
                    FS.unlinkSync(pathName);
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

    async ensureCredentials(scope, registryUrl) {
        const key = `//${this._hostInfo.host}/:_authToken`

        this.makeNpmBackup();
        //Make sure this scope goes to the right registry

        if (!registryUrl) {
            registryUrl = this._hostInfo.href;
        }

        return this._progressListener.progress('Configuring NPM access',
            async () => {
                await this._progressListener.run(`echo '@${scope}:registry=${registryUrl}' >> .npmrc`);
                if (this._accessToken) {
                    await this._progressListener.run(`npm config --location user set "${key}"="${this._accessToken}"`);
                } else {
                    await this._progressListener.run(`npm config --location user set "${key}"=""`);
                }

            });
    }

    async versionExists(packageName, version) {
        try {
            const result = await this._progressListener.run(`npm view --registry ${this._hostInfo.href} ${packageName}@${version} version`);
            return result.output.trim() === version;
        } catch (e) {
            //Ignore - OK if version doesnt exist
            return false;
        }
    }

    async push(name, version, commit) {
        const [scope] = name.split('/');
        await this.ensureCredentials(scope);
        let changedPackage = false;

        try {
            let packageInfo = this._getPackageInfo();
            const npmName = '@' + name;

            await this._progressListener.progress('Checking NPM registry', async () => {
                if (await this.versionExists(npmName, version)) {
                    throw new Error(`NPM version already exists [${npmName}:${version}] - can not be overwritten`);
                } else {
                    this._progressListener.info('NPM registry did not contain version. Proceeding...');
                }
            })

            if (packageInfo.name !== npmName ||
                packageInfo.version !== version) {
                this.makePackageBackup();
                packageInfo.name = npmName;
                packageInfo.version = version;
                this._writePackageInfo(packageInfo);
                changedPackage = true;
            }

            await this._progressListener.progress(`Pushing NPM package: ${npmName}:${version}`,
                () => this._progressListener.run(`npm publish --registry ${this._hostInfo.href}`, this._directory));


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
                registry: this._hostInfo.href
            }
        };
    }

    /**
     *
     * @param {NPMDetails} details
     * @param {string} target
     * @param {RegistryService} registryService
     * @returns {Promise<void>}
     */
    async pull(details, target, registryService) {
        const [scope] = details.name.split('/');
        await this.ensureCredentials(scope, details.registry);
        try {
            await this._progressListener.progress(`Pulling NPM package: ${details.name}:${details.version}`,
                () => this._progressListener.run(`npm pack --registry ${details.registry} --pack-destination=${target} @${details.name}@${details.version}`, this._directory));
        } finally {
            this.restoreNpmBackup();
        }
    }

    /**
     *
     * @param {string} sourcePath
     * @param {string} targetPath
     */
    async install(sourcePath, targetPath) {

        const files = FS.readdirSync(sourcePath);
        const tarFiles = files.filter(file => /.tgz$/.test(file));

        if (tarFiles.length !== 1) {
            throw new Error('Invalid kapeta asset');
        }

        if (FS.existsSync(targetPath)) {
            FSExtra.removeSync(targetPath);
        }

        FSExtra.mkdirpSync(targetPath);

        const absolutePath = Path.join(sourcePath, tarFiles[0]);

        tar.extract({
            file: absolutePath,
            cwd: targetPath,
            sync: true,
            strip: 1 //Needed since we've got a random root directory we want to ignore
        });

        process.env.NODE_ENV = 'production';
        //Install npm dependencies
        await this._progressListener.run('npm install', targetPath);
    }

    _getPackageInfo() {
        const packageJson = FS.readFileSync(Path.join(this._directory, 'package.json')).toString();
        return JSON.parse(packageJson);
    }

    makePackageBackup() {
        this.makeBackup('package.json');
        this.makeBackup('package-lock.json');
    }

    makeNpmBackup() {
        this.makeBackup('.npmrc');
    }

    makeBackup(file) {
        const originalFile = Path.join(this._directory, file);
        const backupFile = Path.join(this._directory, file + '.original');
        if (FS.existsSync(backupFile)) {
            FS.unlinkSync(backupFile);
        }
        if (FS.existsSync(originalFile)) {
            FS.copyFileSync(originalFile, backupFile);
        }
    }

    restoreNpmBackup() {
        this.restoreBackup('.npmrc');
    }

    restorePackageBackup() {
        this.restoreBackup('package.json');
        this.restoreBackup('package-lock.json');
    }

    restoreBackup(file) {
        const backupFile = Path.join(this._directory, file + '.original');
        const originalFile = Path.join(this._directory, file);
        if (FS.existsSync(backupFile)) {
            FS.unlinkSync(originalFile);
            FS.renameSync(backupFile, Path.join(this._directory, file));
        } else {
            //Nothing to backup - get rid of file still
            FS.unlinkSync(originalFile);
        }
    }

    _writePackageInfo(packageJson) {
        FS.writeFileSync(Path.join(this._directory, 'package.json'), JSON.stringify(packageJson, null, 2));
    }

    async build() {
        process.env.NODE_ENV = 'development';

        await this._progressListener.progress('Installing NPM package',
            () => this._progressListener.run('npm install', this._directory)
        );

        let packageInfo = this._getPackageInfo();
        if ('build' in packageInfo.scripts) {
            return this._progressListener.progress('Building NPM package',
                () => this._progressListener.run('npm run build', this._directory));
        } else {
            return this._progressListener.warn('Not building using NPM - no build script found');
        }
    }

    async test() {
        process.env.NODE_ENV = 'development';

        let packageInfo = this._getPackageInfo();
        if ('test' in packageInfo.scripts) {
            return this._progressListener.progress('Testing NPM package', () => this._progressListener.run('npm run test', this._directory));
        } else {
            return this._progressListener.warn('Not testing using NPM - no test script found');
        }
    }
}

module.exports = NPMHandler
