const GitHandler = require('./vcs-handlers/GitHandler');

const VCS_HANDLERS = [
    GitHandler
];

/**
 * Get version control handler for directory
 * @param {ProgressListener} progressListener
 * @param {string} directory
 * @returns {VCSHandler|null}
 */
exports.getVCSHandler = async (progressListener, directory) => {
    for(let i = 0 ; i < VCS_HANDLERS.length; i++) {
        const handler = VCS_HANDLERS[i];
        if (await handler.isRepo(directory)) {
            return new handler(progressListener);
        }
    }

    return null;
};

/**
 * Get version control handler for type
 * @param {ProgressListener} progressListener
 * @param {string} type
 * @returns {VCSHandler|null}
 */
exports.getVCSHandlerByType = async (progressListener, type) => {
    for(let i = 0 ; i < VCS_HANDLERS.length; i++) {
        const handler = VCS_HANDLERS[i];
        if (handler.getType().toLowerCase() === type.toLowerCase()) {
            return new handler(progressListener);
        }
    }

    return null;
};