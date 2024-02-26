/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */
import { DockerHandler } from './handlers/artifact-handlers/DockerHandler';
import { NPMHandler } from './handlers/artifact-handlers/NPMHandler';
import { MavenHandler } from './handlers/artifact-handlers/MavenHandler';
import { YAMLHandler } from './handlers/artifact-handlers/YAMLHandler';
import { GitHandler } from './handlers/vcs-handlers/GitHandler';
import { install } from './actions/install';
import { uninstall } from './actions/uninstall';
import { push } from './actions/push';
import { clone } from './actions/clone';
import { link } from './actions/link';
import { view } from './actions/view';
import _Config from './config';

export const Config = _Config;

export * from './types';

export * from './services/RegistryService';
export * from './services/DockerService';
export * from './handlers/ArtifactHandler';
export * from './handlers/VCSHandler';
export * from './actions/PushOperation';

export const Actions = {
    install,
    uninstall,
    push,
    clone,
    link,
    view,
};

export const vcs = {
    GitHandler,
};
export const handlers = {
    DockerHandler,
    NPMHandler,
    MavenHandler,
    YAMLHandler,
};
