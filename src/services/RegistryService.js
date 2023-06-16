const request = require('request-promise-native');
const { KapetaAPI } = require('@kapeta/nodejs-api-client');

class RegistryService {
    /**
     *
     * @param {string} baseUrl
     * @param {string} handle
     */
    constructor(baseUrl, handle) {
        this.baseUrl = baseUrl;
        this.handle = handle;
        this.api = new KapetaAPI();
    }

    /**
     *
     * @param {AssetDefinition} asset
     * @returns {Promise<AssetReference[]>}
     */
    async resolveDependencies(asset) {
        return this._request('POST', `/dependencies/resolve`, asset);
    }

    /**
     *
     * @param {AssetDefinition} asset
     * @param {ReferenceMap[]} dependencies
     * @return {Promise<AssetDefinition>}
     */
    async updateDependencies(asset, dependencies) {
        return this._request('POST', `/dependencies/update`, { asset, dependencies });
    }

    /**
     *
     * @param {ReservationRequest} assets
     * @returns {Promise<Reservation>}
     */
    async reserveVersions(assets) {
        return this._request('POST', `/reserve`, assets);
    }

    /**
     *
     * @param {string} reservationId
     * @param {AssetVersion[]} assetVersions
     * @returns {Promise<void>}
     */
    async commitReservation(reservationId, assetVersions) {
        return this._request('POST', `/commit`, assetVersions, {
            'If-Match': reservationId,
        });
    }

    /**
     *
     * @param {Reservation} reservation
     * @returns {Promise<void>}
     */
    async abortReservation(reservation) {
        return this._request('DELETE', `/reservations/${encodeURIComponent(reservation.id)}/abort`);
    }

    /**
     *
     * @param {string} name
     * @param {string} version
     * @returns {Promise<AssetVersion>}
     */
    async getVersion(name, version) {
        let handle = this.handle;
        if (!version) {
            version = 'current';
        }

        if (name.indexOf('/') > -1) {
            [handle, name] = name.split('/');
        }

        return this._request(
            'GET',
            `/${encodeURIComponent(handle)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
        );
    }

    /**
     *
     * @param {string} name
     * @param {string} version
     * @returns {Promise<AssetVersion>}
     */
    async getLatestVersionBefore(name, version) {
        return this._request(
            'GET',
            `/${encodeURIComponent(this.handle)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}/previous`
        );
    }

    async _request(method, path, body, headers) {
        const authHeaders = {};
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
        } catch (e) {
            if (e.message.indexOf('ECONNREFUSED') > -1) {
                throw new Error(
                    `Failed to reach Kapeta registry on ${this.baseUrl}. Please check your settings and try again.`
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

module.exports = RegistryService;
