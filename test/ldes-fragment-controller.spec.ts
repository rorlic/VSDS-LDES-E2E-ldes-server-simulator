import { readFileSync } from 'node:fs';
import { LdesFragmentController, LdesFragmentRepository, LdesFragmentService, IAlias, ITreeRelated, TreeRelation, IHeaders, IContextual } from '../src'
import { fetch } from 'undici';

describe('controller tests', () => {
    const dataRoot = "./test/data"
    const mimeJsonLd = 'application/ld+json';
    const originalBaseUrl = new URL('http://www.example.org');
    const controllerBaseUrl = new URL("http://www.ldes-server-simulator.org");
    const firstPartialId = '/id/fragment/1';
    const secondPartialId = '/id/fragment/2';
    const thirdPartialId = '/id/fragment/3';
    const body = {
        '@id': new URL(firstPartialId, originalBaseUrl).href,
        "tree:relation": [
            { "tree:node": new URL(secondPartialId, originalBaseUrl).href } as TreeRelation,
            { "tree:node": new URL(thirdPartialId, originalBaseUrl).href } as TreeRelation,
        ]
    } as ITreeRelated;
    const headers: IHeaders = { 'content-type': mimeJsonLd };
    const partialWithQueryId = '/fragment?id=1';
    const queryIdAlias: IAlias = {
        alias: new URL(partialWithQueryId, originalBaseUrl).href,
        original: new URL(firstPartialId, originalBaseUrl).href
    };

    let sut: LdesFragmentController;
    let repository: LdesFragmentRepository;

    beforeEach(() => {
        repository = new LdesFragmentRepository();
        sut = new LdesFragmentController(new LdesFragmentService(controllerBaseUrl, repository));
    });

    describe('get statistics tests', () => {
        it('should initially return empty statistics', () => {
            const statistics = sut.getStatistics();
            expect(statistics.body).not.toBe(undefined);
            expect(statistics.body.aliases).toHaveLength(0);
            expect(statistics.body.fragments).toHaveLength(0);
        });
        it('should return correct statistics', async () => {
            await sut.postFragment({ body: body, headers: headers });
            sut.postAlias({ body: queryIdAlias });
            const statistics = sut.getStatistics();
            expect(statistics.body).not.toBe(undefined);
            expect(statistics.body.aliases).toEqual([partialWithQueryId]);
            expect(statistics.body.fragments).toEqual([firstPartialId]);
            expect(statistics.body.responses).toStrictEqual({});
        });
        it('should update response statistics', async () => {
            await sut.postFragment({ body: body, headers: headers });
            sut.postAlias({ body: queryIdAlias });
            sut.getFragment({ query: { id: queryIdAlias.original } }, controllerBaseUrl);

            const now = new Date();
            const statistics = sut.getStatistics();
            expect(statistics.body).not.toBe(undefined);
            expect(statistics.body.responses).not.toBe(undefined);

            const firstStatistics = statistics.body.responses[queryIdAlias.original];
            expect(firstStatistics).not.toBe(undefined);
            expect(firstStatistics?.count).toBe(1);
            expect(firstStatistics?.at.length).toBe(1);

            const expectedAtRoundedToSeconds = now.valueOf() / 1000;
            const actualAtRoundedToSeconds = (firstStatistics?.at?.[0]?.valueOf() ?? 0) / 1000;
            expect(actualAtRoundedToSeconds).toBeCloseTo(expectedAtRoundedToSeconds, 0);
        });
    });

    describe('store fragment tests', () => {
        it('should store the fragment with headers', async () => {
            const fragmentInfo = await sut.postFragment({ body: body, headers: headers });
            expect(fragmentInfo.body).not.toBe(undefined);
            expect(fragmentInfo.body.id).toBe(firstPartialId);

            const fragment = repository.get(firstPartialId);
            expect(fragment).not.toBeUndefined();
            expect(fragment?.headers).toEqual({ ...headers, "cache-control": "public, max-age=604800, immutable" });
        });
        it('should replace the fragment ID', async () => {
            await sut.postFragment({ body: body, headers: headers });
            const fragment = repository.get(firstPartialId);
            expect(fragment).not.toBeUndefined();
            expect(fragment?.content).not.toBeUndefined();
            expect(fragment?.content?.['@id']).toBe(new URL(firstPartialId, controllerBaseUrl).href);
        });
        it("should replace the relation's node ID", async () => {
            await sut.postFragment({ body: body, headers: headers });
            const fragment = repository.get(firstPartialId);
            expect(fragment).not.toBeUndefined();
            expect(fragment?.content?.['tree:relation'].length).toBe(body['tree:relation'].length);
            expect(fragment?.content?.['tree:relation'].map((x: TreeRelation) => x['tree:node'])).toEqual([
                new URL(secondPartialId, controllerBaseUrl).href,
                new URL(thirdPartialId, controllerBaseUrl).href
            ]);
        });
    });

    describe('retrieve fragment tests', () => {
        it('should return stored fragment on request', () => {
            repository.save(firstPartialId, body, { 'content-type': mimeJsonLd });
            const fragment = sut.getFragment({ query: { id: firstPartialId } }, controllerBaseUrl);
            expect(fragment.body).not.toBeUndefined();
            expect(fragment.body?.['@id']).toBe(body['@id']);
        });
        it('should return 404 if fragment not found', () => {
            const fragment = sut.getFragment({ query: { id: '/dummy/id' } }, controllerBaseUrl);
            expect(fragment.body).toBeUndefined();
            expect(fragment.status).toBe(404);
        });
    });

    describe('redirection tests', () => {
        it('should store alias', () => {
            const redirect = sut.postAlias({ body: queryIdAlias });
            expect(redirect.body).not.toBeUndefined();
            expect(redirect.body).toEqual({ from: partialWithQueryId, to: firstPartialId });
        });
        it('should retrieve fragments by alias', async () => {
            await sut.postFragment({ body: body, headers: headers });
            sut.postAlias({ body: queryIdAlias });
            const fragment = sut.getFragment({ query: { id: partialWithQueryId } }, controllerBaseUrl);
            expect(fragment.body).toBeUndefined();
            expect(fragment.status).toEqual(302);
            expect(fragment.headers?.['Location']).toBe(body['@id']);
        });
        it('should retrieve fragments by alias, even recursively', async () => {
            await sut.postFragment({ body: body, headers: headers });
            sut.postAlias({ body: queryIdAlias });

            const firstMemberId = '/fragment/first';
            const firstMemberAlias: IAlias = {
                alias: new URL(firstMemberId, originalBaseUrl).href,
                original: new URL(partialWithQueryId, originalBaseUrl).href
            };
            sut.postAlias({ body: firstMemberAlias });
            const fragment = sut.getFragment({ query: { id: firstMemberId } }, controllerBaseUrl);
            expect(fragment.body).toBeUndefined();
            expect(fragment.status).toEqual(302);
            expect(fragment.headers?.['Location']).toBe(body['@id']);
        });
    });

    describe('seed tests', () => {
        it('should serve seeded data', async () => {
            await sut.seed(dataRoot);
            expect(sut.getFragment({ query: { id: '/id/fragment/1' } }, controllerBaseUrl)).not.toBeUndefined();
            expect(sut.getFragment({ query: { id: '/id/fragment/2' } }, controllerBaseUrl)).not.toBeUndefined();
        });
    });

    describe('Cache-Control tests', () => {
        it('should return immutable by default', async () => {
            await sut.postFragment({ body: body, headers: headers });
            const fragment = sut.getFragment({ query: { id: firstPartialId } }, controllerBaseUrl);
            expect(fragment.headers).not.toBeUndefined();

            const cacheControl = fragment.headers && fragment.headers['cache-control'] as string;
            expect(cacheControl).not.toBeUndefined();

            const directives = cacheControl?.split(',').map(x => x.trim());
            expect(directives).toContain('public');
            expect(directives).toContain('immutable');
            expect(directives).toContain('max-age=604800');
        });
        it('should return correct cache control when passing validity seconds (max-age)', async () => {
            const seconds = 5;
            await sut.postFragment({ body: body, headers: headers, query: { 'max-age': seconds } });

            const fragment = sut.getFragment({ query: { id: firstPartialId } }, controllerBaseUrl);
            const cacheControl = fragment.headers && fragment.headers['cache-control'] as string;

            const directives = cacheControl?.split(',').map(x => x.trim());
            expect(directives).toContain('public');
            expect(directives).not.toContain('immutable');

            const maxAge = directives?.find(x => x.startsWith('max-age='));
            expect(maxAge).not.toBeUndefined();

            const age = maxAge ? Number.parseInt(maxAge?.replace('max-age=', '')) : undefined;
            expect(age).toBe(seconds);
        });
    });

    describe('cleanup tests', () => {
        it('should remove all fragments, aliases and responses', async () => {
            await sut.postFragment({ body: body, headers: headers });
            sut.postAlias({ body: queryIdAlias });

            const response = sut.deleteAll();
            expect(response.status).toBe(200);
            expect(response.body).not.toBe(undefined);
            expect(response.body.aliasCount).toBe(1);
            expect(response.body.fragmentCount).toBe(1);

            const statistics = sut.getStatistics();
            expect(statistics.body).not.toBe(undefined);
            expect(statistics.body.aliases).toHaveLength(0);
            expect(statistics.body.fragments).toHaveLength(0);
        });
    });

    describe('JSON-LD context tests', () => {
        function getBody(partialPath: string): ITreeRelated {
            const content = readFileSync(partialPath, { encoding: 'utf8' });
            return JSON.parse(content) as ITreeRelated;
        }

        const sensorsId = "/id/sensors";

        const geojsonContextId = "/geojson-ld/geojson-context.jsonld";
        const geojsonLocalContext = new URL(geojsonContextId, controllerBaseUrl).href;
        const geojsonRemoteContext = `https://geojson.org${geojsonContextId}`;

        it('should extract single context', async () => {
            await sut.postFragment({ body: getBody(`${dataRoot}/sensors.jsonld`), headers: headers })

            // verify context link replaced
            const fragment = sut.getFragment({ query: { id: sensorsId } }, controllerBaseUrl);
            expect(fragment.body?.['@context']).toBe(geojsonLocalContext)

            // verify local context is available and matches remote context
            const remoteResponse = await fetch(geojsonRemoteContext, { headers: { accept: mimeJsonLd } });
            const expected = (await remoteResponse.json()) as IContextual;
            const localResponse = sut.getFragment({ query: { id: geojsonContextId } }, controllerBaseUrl);
            const actual = localResponse.body;
            expect(actual?.['@context']).toEqual(expected['@context']);
        })

        it('should extract multiple contexts', async () => {
            const ngsiLdContextId = "/ngsi-ld/v1/ngsi-ld-core-context.jsonld";
            const ngsiLdLocalContext = new URL(ngsiLdContextId, controllerBaseUrl).href;
            const dummyRemoteContextId = "https://schema.org/dummy.jsonld";

            await sut.postFragment({ body: getBody(`${dataRoot}/map.jsonld`), headers: headers });

            // verify all links replaced and reacheable
            const mapId = "/id/map";
            const fragment = sut.getFragment({ query: { id: mapId } }, controllerBaseUrl);
            expect(fragment.body?.['@context']).toEqual([geojsonLocalContext, ngsiLdLocalContext, dummyRemoteContextId]);

            expect(sut.getFragment({ query: { id: geojsonContextId } }, controllerBaseUrl).status).toBe(200);
            expect(sut.getFragment({ query: { id: ngsiLdContextId } }, controllerBaseUrl).status).toBe(200);
        })

    });
});
