import _ from 'lodash';
import path from 'node:path';
import fs from 'node:fs';
import simpleGit, { RemoteWithRefs, SimpleGit } from 'simple-git';
import { GitDetails, ProgressListener, VCSHandler } from '../../types';

export class GitHandler implements VCSHandler {
    private _progressListener: ProgressListener;

    constructor(progressListener: ProgressListener) {
        this._progressListener = progressListener;
    }

    static create(progressListener: ProgressListener): GitHandler {
        return new GitHandler(progressListener);
    }

    static async isRepo(directory: string): Promise<boolean> {
        return simpleGit(directory).checkIsRepo();
    }

    static getType(): string {
        return 'git';
    }

    public isRepo(dirname: string): Promise<boolean> {
        return GitHandler.isRepo(dirname);
    }

    public getName(): string {
        return 'Git';
    }

    public getType(): string {
        return GitHandler.getType();
    }

    async add(directory: string, filename: string): Promise<void> {
        await simpleGit(directory).add(filename);
    }

    async commit(directory: string, message: string): Promise<string | null> {
        await simpleGit(directory).commit(message);
        return await this.getLatestCommit(directory);
    }

    async push(directory: string, includeTags: boolean): Promise<void> {
        const [remote, branch] = await this.getRemote(directory);

        this._progressListener.debug('Pushing changes to Git remote: %s/%s', remote, branch);

        const git: SimpleGit = simpleGit(directory);

        await git.push(remote, branch);

        if (includeTags) {
            await git.pushTags(remote);
        }
    }

    async pushTags(directory: string): Promise<void> {
        const [remote] = await this.getRemote(directory);
        const git: SimpleGit = simpleGit(directory);
        this._progressListener.debug('Pushing tags to git remote: %s', remote);
        await git.pushTags(remote);
    }

    async getTagsForLatest(directory: string): Promise<string[]> {
        const git: SimpleGit = simpleGit(directory);

        const tag = await git.tags();
        if (!tag) {
            return [];
        }

        return tag.all.map((tag) => tag.trim());
    }

    async tag(directory: string, tag: string): Promise<boolean> {
        const git: SimpleGit = simpleGit(directory);
        const [remote] = await this.getRemote(directory);
        const existingTags = await this.getTagsForLatest(directory);

        if (existingTags.indexOf(tag) > -1) {
            //Tag already exists - delete and overwrite
            await git.raw(['tag', '-d', tag]);
            await git.raw(['push', remote, '--delete', tag]);
        }

        this._progressListener.debug('Tagging latest commit: %s', tag);

        await git.addTag(tag);

        return true;
    }

    async isWorkingDirectoryClean(directory: string): Promise<boolean> {
        const git: SimpleGit = simpleGit(directory);

        //Update remotes
        await git.raw(['remote', 'update']);

        //Check status
        const status = await git.status();

        const trackedFiles = status.files.filter((file) => file.index !== '?');

        return trackedFiles.length === 0;
    }

    async isWorkingDirectoryUpToDate(directory: string): Promise<boolean> {
        const git: SimpleGit = simpleGit(directory);
        //Update remotes
        await git.raw(['remote', 'update']);

        //Check status
        const status = await git.status();

        return status.behind === 0;
    }

    async getBranch(directory: string): Promise<{ branch: string; main: boolean }> {
        const [remote, branch] = await this.getRemote(directory);
        const git: SimpleGit = simpleGit(directory);

        const remoteInfoRaw = await git.remote(['show', remote]);
        if (!remoteInfoRaw) {
            throw new Error(`Failed to get remote info for ${remote}`);
        }

        const result = /HEAD branch: (.+)/.exec(remoteInfoRaw);
        if (!result) {
            throw new Error(`Could not determine default branch from git remote: ${remote}, current branch: ${branch}`);
        }

        let [, defaultBranch] = result;

        if (!defaultBranch) {
            throw new Error(`Could not determine default branch from git remote: ${remote}, current branch: ${branch}`);
        }

        const kapetaReleaseBranch = process.env.KAPETA_RELEASE_BRANCH;

        return {
            branch,
            main: defaultBranch === branch || kapetaReleaseBranch === branch,
        };
    }

    async getLatestCommit(directory: string): Promise<string | null> {
        const logs = await simpleGit(directory).log({ n: 1 });

        if (logs.latest && logs.latest.hash) {
            return logs.latest.hash;
        }

        return null;
    }

    async getCommitsSince(directory: string, commitId: string): Promise<string[]> {
        const git: SimpleGit = simpleGit(directory);
        let logs;
        try {
            logs = await git.log({ from: commitId });
        } catch (e) {
            console.warn(`Failed to get logs from git from commit: ${commitId}`, e);
            console.warn('Getting latest commit instead');
            // This might happen for a force push or and invalid commit id
            // Just get the latest (current) commit instead
            logs = await git.log({ n: 1 });
        }

        return logs.all.map((log) => {
            return log.message;
        });
    }

    async getCheckoutInfo(directory: string): Promise<GitDetails> {
        const [remote, branch] = await this.getRemote(directory);

        const git: SimpleGit = simpleGit(directory);
        const remotes = await git.getRemotes(true);

        //git rev-parse --show-toplevel
        const topLevelDir = await git.revparse(['--show-toplevel']);
        let relativePath;
        if (directory.indexOf(topLevelDir) === 0) {
            relativePath = directory.substring(topLevelDir.length + 1);
        }

        if (!relativePath || relativePath === '/') {
            relativePath = '.';
        } else if (!relativePath.startsWith('./')) {
            relativePath = './' + relativePath;
        } else if (!relativePath.startsWith('.')) {
            relativePath = '.' + relativePath;
        }

        const remoteInfo = _.find(remotes, { name: remote });

        if (remoteInfo?.refs && remoteInfo.refs.fetch) {
            return {
                url: remoteInfo.refs.fetch,
                remote: remote,
                branch: branch,
                path: relativePath,
            };
        }

        throw new Error(
            'Failed to identify remote checkout url to use. Verify that your local repository is properly configured.',
        );
    }

    async getRemote(directory: string): Promise<[string, string]> {
        const git: SimpleGit = simpleGit(directory);
        const status = await git.status();

        if (status.tracking) {
            return status.tracking
                .trim()
                .split(/\//)
                .map((t) => t.trim()) as [string, string];
        }

        if (!status.current) {
            throw new Error('Failed to identify current branch in git repository.');
        }

        const remotes = await git.getRemotes(true);
        const branch = status.current.trim();

        if (remotes.length === 0) {
            throw new Error('No remotes defined for git repository.');
        }

        if (remotes.length === 1) {
            return [remotes[0].name.trim(), branch];
        }

        if (remotes.length > 1) {
            //Multiple remotes - let's first look for origin
            const originRemote = remotes.find((r) => r.name === 'origin');
            if (originRemote) {
                //We check for origin first - that's the most commonly used name for remotes
                return [originRemote.name.trim(), branch];
            }

            //If origin not found - let's look for known cloud providers like Github
            const cloudRemote = remotes.find((remote) => {
                return remote.refs && remote.refs.push && /bitbucket|github|gitlab/i.test(remote.refs.push);
            });

            if (cloudRemote) {
                //We check for origin first - that's the most commonly used name for remotes
                return [cloudRemote.name.trim(), branch];
            }
        }

        throw new Error('Failed to identify remote to use and local branch is not tracking any.');
    }

    async clone(checkoutInfo: GitDetails, checkoutId: string, targetFolder: string): Promise<string> {
        const git: SimpleGit = simpleGit();

        const isRepo = fs.existsSync(targetFolder) && (await simpleGit(targetFolder).checkIsRepo());

        if (isRepo) {
            const directoryInfo = await this.getCheckoutInfo(targetFolder);
            if (directoryInfo.url !== checkoutInfo.url) {
                throw new Error(
                    `Git repository already exists in ${targetFolder} and does not match ${checkoutInfo.url}`,
                );
            }

            await this._progressListener.check(`Git repository existed and matched`, true);
        } else {
            let url = checkoutInfo.url;
            if (url.startsWith('https://github.com/')) {
                //We prefer the git protocol over https for github
                url = url.replace('https://github.com/', 'git@github.com:') + '.git';
            }
            if (checkoutInfo.path && checkoutInfo.path !== '.') {
                await this._progressListener.progress(
                    `Cloning sparse GIT repository ${url} to ${targetFolder}`,
                    async () => {
                        await git.clone(url, targetFolder, ['--no-checkout']);
                        await simpleGit(targetFolder).addConfig('core.sparsecheckout', 'true');
                        fs.writeFileSync(
                            path.join(targetFolder, '.git/info/sparse-checkout'),
                            checkoutInfo.path.substring(2),
                        );
                    },
                );
            } else {
                await this._progressListener.progress(`Cloning GIT repository ${url} to ${targetFolder}`, async () => {
                    await git.clone(url, targetFolder);
                });
            }
        }

        const gitRepo = simpleGit(targetFolder);

        await this._progressListener.progress(`Checking out ${checkoutId}`, async () => {
            await gitRepo.checkout(checkoutId);
        });

        return path.join(targetFolder, checkoutInfo.path);
    }
}
