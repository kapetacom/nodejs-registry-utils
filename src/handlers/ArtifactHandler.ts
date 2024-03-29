/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */
import { NPMHandler } from './artifact-handlers/NPMHandler';
import { MavenHandler } from './artifact-handlers/MavenHandler';

import { ArtifactHandler, ArtifactHandlerFactory, ProgressListener } from '../types';
import { YAMLHandler } from './artifact-handlers/YAMLHandler';
import { DockerHandler } from './artifact-handlers/DockerHandler';

const ARTIFACT_HANDLERS: ArtifactHandlerFactory[] = [DockerHandler, NPMHandler, MavenHandler, YAMLHandler];

export async function getArtifactHandler(
    progressListener: ProgressListener,
    baseKind: string,
    assetKind: string,
    directory: string,
    accessToken: string,
): Promise<ArtifactHandler | null> {
    let handler: ArtifactHandler | null = null;

    if (baseKind === 'core/block-type-executable' && assetKind !== baseKind) {
        // If this is a block of a block-type that is executable, we need to use the YAML handler
        if (YAMLHandler.isSupported()) {
            return YAMLHandler.create(progressListener, directory, accessToken);
        }
    }

    for (let i = 0; i < ARTIFACT_HANDLERS.length; i++) {
        const handler = ARTIFACT_HANDLERS[i];
        if (await handler.isSupported(directory)) {
            return handler.create(progressListener, directory, accessToken);
        }
    }

    return handler;
}

export function getArtifactHandlerByType(
    progressListener: ProgressListener,
    type: string,
    accessToken?: string,
): ArtifactHandler | null {
    for (let i = 0; i < ARTIFACT_HANDLERS.length; i++) {
        const handler = ARTIFACT_HANDLERS[i];
        if (handler.getType().toLowerCase() === type.toLowerCase()) {
            return handler.create(progressListener, process.cwd(), accessToken);
        }
    }

    return null;
}
