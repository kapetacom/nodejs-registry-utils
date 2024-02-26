/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */
import request from 'request-promise-native';
import { KapetaAPI } from '@kapeta/nodejs-api-client';
import { parseKapetaUri } from '@kapeta/nodejs-utils';
import { AssetDefinition, AssetReference, AssetVersion, ReferenceMap, Reservation, ReservationRequest } from '../types';

export class RegistryService {
    baseUrl: string;
    handle: string;
    api: KapetaAPI;

    constructor(baseUrl: string, handle: string) {
        this.baseUrl = baseUrl;
        this.handle = handle;
        this.api = new KapetaAPI();
    }

    async resolveDependencies(asset: AssetDefinition): Promise<AssetReference[]> {
        return this._request('POST', `/dependencies/resolve`, asset);
    }

    async updateDependencies(asset: AssetDefinition, dependencies: ReferenceMap[]): Promise<AssetDefinition> {
        return this._request('POST', `/dependencies/update`, { asset, dependencies });
    }

    async reserveVersions(assets: ReservationRequest): Promise<Reservation> {
        return this._request('POST', `/reserve`, assets);
    }

    async commitReservation(reservationId: string, assetVersions: AssetVersion[]): Promise<void> {
        return this._request('POST', `/commit`, assetVersions, {
            'If-Match': reservationId,
        });
    }

    async abortReservation(reservation: Reservation): Promise<void> {
        return this._request('DELETE', `/reservations/${encodeURIComponent(reservation.id)}/abort`);
    }

    async getVersion(name: string, version: string): Promise<AssetVersion> {
        let handle = this.handle;
        if (!version) {
            version = 'current';
        }

        if (name.indexOf('/') > -1) {
            [handle, name] = name.split('/');
        }

        return this._request(
            'GET',
            `/${encodeURIComponent(handle)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
        );
    }

    async getLatestVersionBefore(name: string, version: string): Promise<AssetVersion> {
        return this._request(
            'GET',
            `/${encodeURIComponent(this.handle)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}/previous`,
        );
    }

    async getLatestVersion(name: string): Promise<AssetVersion> {
        const uri = parseKapetaUri(name);
        return this._request('GET', `/${encodeURIComponent(uri.handle)}/${encodeURIComponent(uri.name)}/latest`);
    }

    private async _request(method: string, path: string, body?: any, headers?: any): Promise<any> {
        const authHeaders: any = {};
        const token = await this.api.getAccessToken().catch(() => undefined);
        if (token) {
            authHeaders['authorization'] = `Bearer ${token}`;
        }
        try {
            const requestOptions = {
                method,
                url: this.baseUrl + `/v1/registry${path}`,
                body: body,
                json: true,
                headers: {
                    accept: 'application/json',
                    ...authHeaders,
                    ...headers,
                },
            };

            return await request(requestOptions);
        } catch (e: any) {
            if (e.message.indexOf('ECONNREFUSED') > -1) {
                throw new Error(
                    `Failed to reach Kapeta registry on ${this.baseUrl}. Please check your settings and try again.`,
                );
            }

            if (e.statusCode > 0) {
                if (e.statusCode === 404) {
                    return null;
                }

                if (e.response && e.response.body) {
                    const errorStructure = e.response.body;
                    if (errorStructure.message) {
                        throw new Error(errorStructure.message);
                    }
                }
            }

            throw e;
        }
    }
}
