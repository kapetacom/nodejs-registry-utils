/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */
import DockerfileParser from 'docker-file-parser';
import FS from 'fs';
import Path from 'path';
import * as glob from 'glob';
import tar from 'tar-fs';
import zlib from 'node:zlib';
import crypto from 'crypto';
import os from 'os';
import { promisifyStream } from '../utils/promise-utils';
import { UrlWithStringQuery } from 'node:url';
import { ProgressListener } from '../types';

export class DockerService {
    private _progressListener: ProgressListener;
    private _hostInfo: UrlWithStringQuery;
    private _accessToken: string;
    private _configDir: string | null;
    private _configFile: string | null;

    constructor(progressListener: ProgressListener, hostInfo: UrlWithStringQuery, accessToken: string) {
        this._progressListener = progressListener;
        this._hostInfo = hostInfo;
        this._accessToken = accessToken;
        this._configDir = null;
        this._configFile = null;

        this._ensureConfig();
    }

    private _ensureConfig(): void {
        const auth: string = this._accessToken
            ? Buffer.from(`kapeta:${this._accessToken}`).toString('base64')
            : Buffer.from(`kapeta:anonymous`).toString('base64');

        this._configDir = `${os.homedir()}/.docker`;
        this._configFile = `${this._configDir}/config.json`;
        let config: any;
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

        config.auths[this._hostInfo.host!] = { auth };
        config.credHelpers[this._hostInfo.host!] = '';

        FS.writeFileSync(this._configFile, JSON.stringify(config, null, 2));
    }

    public async verify(): Promise<any> {
        return this._progressListener.run('docker version');
    }

    public async pull(image: string): Promise<any> {
        let [imageName, tag] = DockerService.splitName(image);
        if (!tag) {
            tag = 'latest';
        }

        return this._progressListener.run(`docker --config ${this._configDir} pull ${imageName}:${tag}`);
    }

    private _pack(directory: string): any {
        const entries: string[] = this._getFilesToBeAdded(Path.join(directory, 'Dockerfile'));
        entries.push('Dockerfile');

        const pack = tar.pack(directory, {
            entries,
        });

        return pack.pipe(zlib.createGzip());
    }

    public async calculateChecksum(directory: string): Promise<string> {
        const hash = crypto.createHash('sha256');
        const stream = this._pack(directory);

        stream.on('data', function (data: any) {
            hash.update(data);
        });

        await promisifyStream(stream);

        return hash.digest('hex');
    }

    public async build(directory: string, imageTags: string[]): Promise<void> {
        const platforms: string[] = ['linux/amd64'];
        try {
            const { output } = await this._progressListener.run(`docker buildx inspect`, directory);
            if (typeof output === 'string' && output.includes('linux/arm64')) {
                //If we've got linux/arm64 - add that to the list of platforms
                platforms.push('linux/arm64');
            }
        } catch (e) {
            // Ignore
        }

        await this._progressListener.run(
            `docker buildx build --platform ${platforms.join(',')} ${imageTags.map((tag) => `-t ${tag}`).join(' ')} --push .`,
            directory,
        );
    }

    public async push(tags: string[]): Promise<void> {
        for (let i = 0; i < tags.length; i++) {
            const fullTag = tags[i];
            await this._progressListener.progress('Pushing docker image: ' + fullTag, async () => {
                await this._progressListener.run(`docker --config ${this._configDir} push ${fullTag}`);
            });
        }
    }

    public static splitName(imageName: string): [string, string] {
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

    public async tag(imageName: string, tags: string[]): Promise<void> {
        for (let i = 0; i < tags.length; i++) {
            const fullTag = tags[i];
            await this._progressListener.run(`docker tag ${imageName} ${fullTag}`);
        }
    }

    private _getFilesToBeAdded(dockerfile: string): string[] {
        const dockerFileContent: string = FS.readFileSync(dockerfile).toString();
        const directory: string = Path.dirname(dockerfile);

        const dockerCommands = DockerfileParser.parse(dockerFileContent);

        const addCommands = dockerCommands.filter((command: any) => ['COPY', 'ADD'].indexOf(command.name) > -1);

        let files: string[] = [];

        addCommands.forEach((addCommand: any) => {
            const addedFiles = glob.sync(addCommand.args[0], { cwd: directory });
            files = files.concat(addedFiles);
        });

        return files;
    }
}
