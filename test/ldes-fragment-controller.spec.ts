import { LdesFragmentController, LdesFragmentRepository, LdesFragmentService, IAlias, IHeaders } from '../src'
import * as RDF from "@rdfjs/types";
import { Store, DataFactory } from "n3";
const { namedNode, blankNode, quad } = DataFactory;

describe('controller tests', () => {
    const dataRoot = "./test/data"
    const mimeJsonLd = 'application/ld+json';
    const originalBaseUrl = new URL('http://www.example.org');
    const controllerBaseUrl = new URL("http://www.ldes-server-simulator.org");
    const firstPartialId = '/id/fragment/1';
    const secondPartialId = '/id/fragment/2';
    const thirdPartialId = '/id/fragment/3';
    const firstOriginalId = new URL(firstPartialId, originalBaseUrl).href;
    const firstOriginalSubjectId = namedNode(firstOriginalId);
    const firstFragmentId = new URL(firstPartialId, controllerBaseUrl).href;
    const firstSubjectId = namedNode(firstFragmentId);
    const treeRelation = namedNode('https://w3id.org/tree#relation');
    const treeNode = namedNode('https://w3id.org/tree#node');
    const treeNodeType = namedNode('https://w3id.org/tree#Node');
    const rdfType = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
    const relationOne = blankNode();
    const relationTwo = blankNode();
    const quads: RDF.Quad[] = [
        quad(firstOriginalSubjectId, rdfType, treeNodeType),

        quad(firstOriginalSubjectId, treeRelation, relationOne),
        quad(relationOne, treeNode, namedNode(new URL(secondPartialId, originalBaseUrl).href)),
        
        quad(firstOriginalSubjectId, treeRelation, relationTwo),
        quad(relationTwo, treeNode, namedNode(new URL(thirdPartialId, originalBaseUrl).href)),
    ];

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
            await sut.postFragment({ body: quads, headers: headers });
            sut.postAlias({ body: queryIdAlias });
            const statistics = sut.getStatistics();
            expect(statistics.body).not.toBe(undefined);
            expect(statistics.body.aliases).toEqual([partialWithQueryId]);
            expect(statistics.body.fragments).toEqual([firstPartialId]);
            expect(statistics.body.responses).toStrictEqual({});
        });
        it('should update response statistics', async () => {
            await sut.postFragment({ body: quads, headers: headers });
            sut.postAlias({ body: queryIdAlias });
            await sut.getFragment({ query: { id: queryIdAlias.original } }, controllerBaseUrl);

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

    function getFragmentId(quads: RDF.Quad[]) {
        const store = new Store(quads);
        const fragmentId = store.getSubjects(rdfType, treeNodeType, null).shift()?.value;
        return fragmentId;
    }

    describe('store fragment tests', () => {
        it('should store the fragment with headers', async () => {
            const fragmentInfo = await sut.postFragment({ body: quads, headers: headers });
            expect(fragmentInfo.body).not.toBe(undefined);
            expect(fragmentInfo.body.id).toBe(firstPartialId);

            const fragment = repository.get(firstPartialId);
            expect(fragment).not.toBeUndefined();
            expect(fragment?.headers).toEqual({ ...headers, "cache-control": "public, max-age=604800, immutable" });
        });
        it('should replace the fragment ID', async () => {
            await sut.postFragment({ body: quads, headers: headers });
            const fragment = repository.get(firstPartialId);
            expect(fragment).not.toBeUndefined();
            expect(fragment?.content).not.toBeUndefined();
            expect(getFragmentId(fragment!.content)).toBe(new URL(firstPartialId, controllerBaseUrl).href);
        });
        it("should replace the relation's node ID", async () => {
            await sut.postFragment({ body: quads, headers: headers });
            const fragment = repository.get(firstPartialId);
            expect(fragment).not.toBeUndefined();

            const store = new Store(fragment!.content);
            const relationSubjects = store.getObjects(firstSubjectId, treeRelation, null);
            expect(relationSubjects.length).toBe(2);

            const nodeObjects = store.getObjects(null, treeNode, null);
            expect(nodeObjects.map(x => x.value)).toEqual([
                new URL(secondPartialId, controllerBaseUrl).href,
                new URL(thirdPartialId, controllerBaseUrl).href
            ]);
        });
    });

    describe('retrieve fragment tests', () => {
        it('should return stored fragment on request', async () => {
            repository.save(firstPartialId, quads, { 'content-type': mimeJsonLd });
            const fragment = await sut.getFragment({ query: { id: firstPartialId } }, controllerBaseUrl);
            expect(fragment.body).not.toBeUndefined();
            expect(getFragmentId(fragment.body!)).toBe(firstOriginalId);
        });
        it('should return 404 if fragment not found', async () => {
            const fragment = await sut.getFragment({ query: { id: '/dummy/id' } }, controllerBaseUrl);
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
            await sut.postFragment({ body: quads, headers: headers });
            sut.postAlias({ body: queryIdAlias });
            const fragment = await sut.getFragment({ query: { id: partialWithQueryId } }, controllerBaseUrl);
            expect(fragment.body).toBeUndefined();
            expect(fragment.status).toEqual(302);
            expect(fragment.headers?.['Location']).toBe(firstFragmentId);
        });
        it('should retrieve fragments by alias, even recursively', async () => {
            await sut.postFragment({ body: quads, headers: headers });
            sut.postAlias({ body: queryIdAlias });

            const firstMemberId = '/fragment/first';
            const firstMemberAlias: IAlias = {
                alias: new URL(firstMemberId, originalBaseUrl).href,
                original: new URL(partialWithQueryId, originalBaseUrl).href
            };
            sut.postAlias({ body: firstMemberAlias });
            const fragment = await sut.getFragment({ query: { id: firstMemberId } }, controllerBaseUrl);
            expect(fragment.body).toBeUndefined();
            expect(fragment.status).toEqual(302);
            expect(fragment.headers?.['Location']).toBe(firstFragmentId);
        });
    });

    describe('seed tests', () => {
        it('should serve seeded data', async () => {
            await sut.seed(dataRoot);
            expect(await sut.getFragment({ query: { id: '/id/fragment/1' } }, controllerBaseUrl)).not.toBeUndefined();
            expect(await sut.getFragment({ query: { id: '/id/fragment/2' } }, controllerBaseUrl)).not.toBeUndefined();
        });
    });

    describe('Cache-Control tests', () => {
        it('should return immutable by default', async () => {
            await sut.postFragment({ body: quads, headers: headers });
            const fragment = await sut.getFragment({ query: { id: firstPartialId } }, controllerBaseUrl);
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
            await sut.postFragment({ body: quads, headers: headers, query: { 'max-age': seconds } });

            const fragment = await sut.getFragment({ query: { id: firstPartialId } }, controllerBaseUrl);
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
            await sut.postFragment({ body: quads, headers: headers });
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

    // describe('JSON-LD context tests', () => {
    //     function getBody(partialPath: string): ITreeRelated {
    //         const content = readFileSync(partialPath, { encoding: 'utf8' });
    //         return JSON.parse(content) as ITreeRelated;
    //     }

    //     const sensorsId = "/id/sensors";

    //     const geojsonContextId = "/geojson-ld/geojson-context.jsonld";
    //     const geojsonLocalContext = new URL(geojsonContextId, controllerBaseUrl).href;
    //     const geojsonRemoteContext = `https://geojson.org${geojsonContextId}`;

    //     it('should extract single context', async () => {
    //         await sut.postFragment({ body: getBody(`${dataRoot}/sensors.jsonld`), headers: headers })

    //         // verify context link replaced
    //         const fragment = await sut.getFragment({ query: { id: sensorsId } }, controllerBaseUrl);
    //         expect(fragment.body?.['@context']).toBe(geojsonLocalContext)

    //         // verify local context is available and matches remote context
    //         const remoteResponse = await fetch(geojsonRemoteContext, { headers: { accept: mimeJsonLd } });
    //         const expected = (await remoteResponse.json()) as IContextual;
    //         const localResponse = await sut.getFragment({ query: { id: geojsonContextId } }, controllerBaseUrl);
    //         const actual = localResponse.body;
    //         expect(actual?.['@context']).toEqual(expected['@context']);
    //     })

    //     it('should extract multiple contexts', async () => {
    //         const ngsiLdContextId = "/ngsi-ld/v1/ngsi-ld-core-context.jsonld";
    //         const ngsiLdLocalContext = new URL(ngsiLdContextId, controllerBaseUrl).href;
    //         const dummyRemoteContextId = "https://schema.org/dummy.jsonld";

    //         await sut.postFragment({ body: getBody(`${dataRoot}/map.jsonld`), headers: headers });

    //         // verify all links replaced and reacheable
    //         const mapId = "/id/map";
    //         const fragment = await sut.getFragment({ query: { id: mapId } }, controllerBaseUrl);
    //         expect(fragment.body?.['@context']).toEqual([geojsonLocalContext, ngsiLdLocalContext, dummyRemoteContextId]);

    //         expect(await sut.getFragment({ query: { id: geojsonContextId } }, controllerBaseUrl).status).toBe(200);
    //         expect(await sut.getFragment({ query: { id: ngsiLdContextId } }, controllerBaseUrl).status).toBe(200);
    //     })

    // });
});
