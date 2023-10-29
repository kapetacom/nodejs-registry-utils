/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */


/**
 *
 * @param {Stream} stream
 * @param {DataHandler} [dataHandler]
 * @returns {Promise<any>}
 */
exports.promisifyStream = (stream, dataHandler) => new Promise((resolve, reject) => {
    if (dataHandler) {
        stream.on('data', (d) => {
            dataHandler(d)
        });
    }
    stream.on('end', resolve);
    stream.on('error', reject);
});

