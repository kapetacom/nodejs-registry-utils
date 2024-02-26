/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */
import { Stream } from 'stream';

type DataHandler = (data: any) => void;

export const promisifyStream = (stream: Stream, dataHandler?: DataHandler): Promise<any> =>
    new Promise((resolve, reject) => {
        if (dataHandler) {
            stream.on('data', (d) => {
                dataHandler(d);
            });
        }
        stream.on('end', resolve);
        stream.on('error', reject);
    });
