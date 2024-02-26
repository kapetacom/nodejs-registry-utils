/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */
import YAML from 'yaml';
import { parseKapetaUri } from '@kapeta/nodejs-utils';
import { RegistryService } from '../services/RegistryService';
import Config from '../config';

interface CommandOptions {
    registry?: string;
}

export async function view(uri: string, cmdObj: CommandOptions): Promise<void> {
    const blockInfo = parseKapetaUri(uri);

    const registryService = new RegistryService(cmdObj.registry || Config.data.registry.url, blockInfo.handle);

    const registration = await registryService.getVersion(blockInfo.name, blockInfo.version);

    if (!registration) {
        throw new Error('Registration not found: ' + uri);
    }

    console.log(YAML.stringify(registration));
}
