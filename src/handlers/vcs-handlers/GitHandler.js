const Git = require('simple-git');
const _ = require('lodash');
const Path = require('path');
const FS = require('fs');

/**
 * @implements {VCSHandler}
 */
class GitHandler {
    /**
     * Determines if folder is a git repository
     * @param {string} directory
     * @returns {Promise<boolean>}
     */
    static async isRepo(directory) {
        return await Git(directory).checkIsRepo();
    }

    /**
     * Get type of handler
     *
     * @returns {string}
     */
    static getType() {
        return 'git';
    }

    /**
     *
     * @param {ProgressListener} progressListener
     */
    constructor(progressListener) {
        this._progressListener = progressListener;
    }

    getName() {
        return 'Git';
    }

    getType() {
        return GitHandler.getType();
    }

    async add(directory, filename) {
        await Git(directory).add(filename);
    }

    async commit(directory, message) {
        await Git(directory).commit(message);
        //Return type from commit only includes the short-form commit hash. We want the full thing
        return this.getLatestCommit(directory);
    }

    async push(directory, includeTags) {
        const [remote, branch] = await this.getRemote(directory);

        this._progressListener.debug('Pushing changes to Git remote: %s/%s', remote, branch);

        const git = Git(directory);

        await git.push(remote, branch);

        if (includeTags) {
            await git.pushTags(remote);
        }
    }

    async pushTags(directory) {
        const [remote] = await this.getRemote(directory);
        const git = Git(directory);
        this._progressListener.debug('Pushing tags to git remote: %s', remote);
        await git.pushTags(remote);
    }

    async getTagsForLatest(directory) {
        const git = Git(directory);

        const tag = await git.tags();
        if (!tag) {
            return [];
        }

        return tag.all.map((tag) => tag.trim());
    }

    async tag(directory, tag) {
        const git = Git(directory);
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

    async isWorkingDirectoryClean(directory) {
        const git = Git(directory);

        //Update remotes
        await git.raw(['remote', 'update']);

        //Check status
        const status = await git.status();

        const trackedFiles = status.files.filter((file) => file.index !== '?');

        return trackedFiles.length === 0;
    }

    async isWorkingDirectoryUpToDate(directory) {
        const git = Git(directory);
        //Update remotes
        await git.raw(['remote', 'update']);

        //Check status
        const status = await git.status();

        return status.behind === 0;
    }

    async getBranch(directory) {
        const [remote, branch] = await this.getRemote(directory);
        const git = Git(directory);

        const remoteInfoRaw = await git.remote(['show', remote]);
        let [, defaultBranch] = /HEAD branch: (.+)/.exec(remoteInfoRaw);

        if (!defaultBranch) {
            throw new Error(
                `Could not determine default branch from git remote: ${remote}, current branch: ${branch}`
            );
        }

        return {
            branch,
            main: defaultBranch === branch,
        };
    }

    async getLatestCommit(directory) {
        const logs = await Git(directory).log({ n: 1 });

        if (logs.latest && logs.latest.hash) {
            return logs.latest.hash;
        }

        return null;
    }

    /**
     * Get the latest commit messages since a given commit
     *
     * @param directory
     * @param commitId
     * @returns {Promise<string[]>}
     */
    async getCommitsSince(directory, commitId) {
        const logs = await Git(directory).log({ from: commitId });
        return logs.all.map((log) => {
            return log.message;
        });
    }

    async getCheckoutInfo(directory) {
        const [remote, branch] = await this.getRemote(directory);

        const git = Git(directory);
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

        if (remoteInfo.refs && remoteInfo.refs.fetch) {
            return {
                url: remoteInfo.refs.fetch,
                remote: remote,
                branch: branch,
                path: relativePath,
            };
        }

        throw new Error(
            'Failed to identify remote checkout url to use. Verify that your local repository is properly configured.'
        );
    }

    async getRemote(directory) {
        const git = Git(directory);
        const status = await git.status();

        if (status.tracking) {
            return status.tracking
                .trim()
                .split(/\//)
                .map((t) => t.trim());
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
            const originRemote = _.find(remotes, { name: 'origin' });
            if (originRemote) {
                //We check for origin first - that's the most commonly used name for remotes
                return [originRemote.name.trim(), branch];
            }

            //If origin not found - let's look for known cloud providers like Github
            const cloudRemote = _.find(remotes, (remote) => {
                return (
                    remote.refs &&
                    remote.refs.push &&
                    /bitbucket|github|gitlab/i.test(remote.refs.push)
                );
            });

            if (cloudRemote) {
                //We check for origin first - that's the most commonly used name for remotes
                return [originRemote.name.trim(), branch];
            }
        }

        throw new Error('Failed to identify remote to use and local branch is not tracking any.');
    }

    /**
     *
     * @param {GitDetails} checkoutInfo
     * @param {string} checkoutId
     * @param {string} targetFolder
     * @returns {Promise<string>}
     */
    async clone(checkoutInfo, checkoutId, targetFolder) {
        const git = Git();

        const isRepo = FS.existsSync(targetFolder) && (await Git(targetFolder).checkIsRepo());

        if (isRepo) {
            const directoryInfo = await this.getCheckoutInfo(targetFolder);
            if (directoryInfo.url !== checkoutInfo.url) {
                throw new Error(
                    `Git repository already exists in ${targetFolder} and does not match ${checkoutInfo.url}`
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
                        await Git(targetFolder).addConfig('core.sparsecheckout', 'true');
                        FS.writeFileSync(
                            Path.join(targetFolder, '.git/info/sparse-checkout'),
                            checkoutInfo.path.substring(2)
                        );
                    }
                );
            } else {
                await this._progressListener.progress(
                    `Cloning GIT repository ${url} to ${targetFolder}`,
                    async () => {
                        await git.clone(url, targetFolder);
                    }
                );
            }
        }

        const gitRepo = Git(targetFolder);

        await this._progressListener.progress(`Checking out ${checkoutId}`, async () => {
            await gitRepo.checkout(checkoutId);
        });

        return Path.join(targetFolder, checkoutInfo.path);
    }
}

module.exports = GitHandler;
