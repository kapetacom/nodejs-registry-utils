const DockerfileParser = require('docker-file-parser');
const FS = require('fs');
const Path = require('path');
const glob = require('glob');
const tar = require('tar-fs');
const zlib = require('zlib');
const crypto = require('crypto');
const os = require("os");
const {promisifyStream} = require('../utils/promise-utils');

class DockerService {

    /**
     *
     * @param {ProgressListener} progressListener
     * @param {UrlWithStringQuery} hostInfo
     * @param {string} accessToken
     */
    constructor(progressListener, hostInfo, accessToken) {
        this._progressListener = progressListener;
        this._hostInfo = hostInfo;
        this._accessToken = accessToken;
        this._configDir = null;
        this._configFile = null;

        this._ensureConfig();
    }

    _ensureConfig() {
        const auth = this._accessToken ?
            Buffer.from(`kapeta:${this._accessToken}`).toString('base64')
            : Buffer.from(`kapeta:anonymous`).toString('base64');

        this._configDir = `${os.homedir()}/.docker`;
        this._configFile = `${this._configDir}/config.json`;
        let config;
        if (FS.existsSync(this._configFile)) {
            config = JSON.parse(FS.readFileSync(this._configFile).toString());
            this._progressListener.info(`Ensuring docker configuration in ${this._configFile}`);
        } else {
            this._configDir = `${os.tmpdir()}/.docker`;
            this._configFile = `${this._configDir}/config.json`;
            if (!FS.existsSync(this._configDir)) {
                FS.mkdirSync(this._configDir);
            }
            this._progressListener.info(`Writing temporary docker configuration to ${this._configFile}`);
            config = {};
        }

        if (!config.auths) {
            config.auths = {};
        }

        if (!config.credHelpers) {
            config.credHelpers = {};
        }

        config.auths[this._hostInfo.host] = {auth};
        config.credHelpers[this._hostInfo.host] = '';

        FS.writeFileSync(this._configFile, JSON.stringify(config, null, 2));
    }

    async verify() {
        return this._progressListener.run('docker version');
    }

    async pull(image) {
        let [imageName, tag] = DockerService.splitName(image);
        if (!tag) {
            tag = 'latest';
        }

        return this._progressListener.run(`docker --config ${this._configDir} pull ${imageName}:${tag}`);
    }

    _pack(directory) {
        const entries = this._getFilesToBeAdded(Path.join(directory, 'Dockerfile'));
        entries.push('Dockerfile');

        const pack = tar.pack(directory, {
            entries
        });

        return pack.pipe(zlib.createGzip());
    }

    async calculateChecksum(directory) {
        const hash = crypto.createHash('sha256');
        const stream = this._pack(directory);

        stream.on('data', function(data) {
            hash.update(data);
        });

        await promisifyStream(stream);

        return hash.digest('hex');
    }

    /**
     *
     * @param {string} directory
     * @param {string[]} imageTags
     * @returns {Promise<string>}
     */
    async build(directory, imageTags) {
        await this._progressListener.run(`docker buildx build --platform linux/amd64 ${imageTags.map(tag => `-t ${tag}`)} .`, directory);
    }

    /**
     *
     * @param {string[]} tags
     * @returns {Promise<void>}
     */
    async push(tags) {

        for(let i = 0 ; i < tags.length; i++) {
            const fullTag = tags[i];
            await this._progressListener.progress("Pushing docker image: " + fullTag, async() => {
                await this._progressListener.run(`docker --config ${this._configDir} push ${fullTag}`);
            });
        }
    }

    static splitName(imageName) {
        let slashIx = imageName.lastIndexOf('/');
        if (slashIx < 0) {
            slashIx = 0;
        }

        const colonIx = imageName.lastIndexOf(':');
        if (colonIx < slashIx) {
            //Either not there or part of repo name:
            //- my-image
            //- localhost:5000/my-image
            return [imageName, 'latest'];
        }


        const tag = imageName.substr(colonIx + 1);
        imageName = imageName.substr(0, colonIx);

        return [imageName, tag];
    }

    /**
     *
     * @param {string} imageName
     * @param {string[]} tags
     * @returns {Promise<void>}
     */
    async tag(imageName, tags) {
        for(let i = 0; i < tags.length; i++) {
            const fullTag = tags[i];
            await this._progressListener.run(`docker tag ${imageName} ${fullTag}`);
        }
    }


    /**
     * Reads Dockerfile and returns all files that are to be added to the image
     * @param dockerfile
     * @returns {[]}
     * @private
     */
    _getFilesToBeAdded(dockerfile) {
        const dockerFileContent = FS.readFileSync(dockerfile).toString();
        const directory = Path.dirname(dockerfile);

        const dockerCommands = DockerfileParser.parse(dockerFileContent);

        const addCommands = dockerCommands.filter((command) => ['COPY','ADD'].indexOf(command.name) > -1);

        let files = [];

        addCommands.forEach((addCommand) => {

            const addedFiles = glob.sync(addCommand.args[0], {cwd: directory});
            files = files.concat(addedFiles);
        });


        return files;
    }
}

module.exports = DockerService;
