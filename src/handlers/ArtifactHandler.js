/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */

const DockerHandler = require('./artifact-handlers/DockerHandler');
const NPMHandler = require('./artifact-handlers/NPMHandler');
const MavenHandler = require('./artifact-handlers/MavenHandler');
const YAMLHandler = require('./artifact-handlers/YAMLHandler');

/**
 *
 * @type {ArtifactHandlerFactory[]}
 */
const ARTIFACT_HANDLERS = [
    DockerHandler,
    NPMHandler,
    MavenHandler,
    YAMLHandler
];

/**
 * Get artifact repository handler for directory
 * @param {ProgressListener} progressListener
 * @param {string} directory
 * @param {string} accessToken
 * @returns {ArtifactHandler|null}
 */
exports.getArtifactHandler = async (progressListener, directory, accessToken) => {
    for(let i = 0 ; i < ARTIFACT_HANDLERS.length; i++) {
        const handler = ARTIFACT_HANDLERS[i];
        if (await handler.isSupported(directory)) {
            return handler.create(progressListener, directory, accessToken);
        }
    }

    return null;
};


/**
 * Get artifact repository handler for type
 * @param {ProgressListener} progressListener
 * @param {string} type
 * @param {string} accessToken
 * @returns {ArtifactHandler|null}
 */
exports.getArtifactHandlerByType = (progressListener, type, accessToken) => {
    for(let i = 0 ; i < ARTIFACT_HANDLERS.length; i++) {
        const handler = ARTIFACT_HANDLERS[i];
        if (handler.getType().toLowerCase() === type.toLowerCase()) {
            return handler.create(progressListener, process.cwd(), accessToken);
        }
    }

    return null;
};