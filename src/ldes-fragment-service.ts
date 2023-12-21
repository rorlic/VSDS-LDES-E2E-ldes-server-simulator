import * as RDF from "@rdfjs/types";
import { IFragment, LdesFragmentRepository } from "./ldes-fragment-repository";
import { IFragmentInfo, nsLdes, nsRdf, nsTree } from "./fragment-interfaces";
import { IHeaders } from "./http-interfaces";
import { Store, DataFactory } from 'n3';

export interface ICreateFragmentOptions { 
    'max-age': number;
}

export class LdesFragmentService {
    constructor(private baseUrl: URL, private repository: LdesFragmentRepository) { }

    public async save(quads: RDF.Quad[], options?: ICreateFragmentOptions | undefined, headers?: IHeaders | undefined): Promise<IFragmentInfo> {
        const store = new Store(quads);
        const fragmentId = this.fixUris(store);
        const id = fragmentId?.replace(this.baseUrl.href, '/');
        if (!id) return { id: ''};

        headers = this.addCacheControlHeader(options, headers);
        quads = store.getQuads(null,null,null,null);
        this.repository.save(id, quads, headers);
        return {...headers, id: id};
    }


    private addCacheControlHeader(options: ICreateFragmentOptions | undefined, headers: IHeaders | undefined) {
        const maxAge = options?.['max-age'];
        headers = { ...headers, 'cache-control': maxAge ? `public, max-age=${maxAge}` : 'public, max-age=604800, immutable' };
        return headers;
    }

    private changeOrigin(url: URL, origin: URL): URL {
        url.protocol = origin.protocol;
        url.host = origin.host;
        url.port = origin.port;
        return url;
    }

    private rdfType = nsRdf + 'type';
    private ldesEventStreamType = nsLdes + 'EventStream';
    private treeView = nsTree + 'view';
    private treeNodeType = nsTree + 'Node';
    private treeNode = nsTree + 'node';

    private replaceQuads(store: Store, oldQuads: RDF.Quad[], newQuads: RDF.Quad[]) {
        store.removeQuads(oldQuads);
        store.addQuads(newQuads);
    }

    private fixUris(store: Store) {
        let nodeId = store.getSubjects(this.rdfType, this.treeNodeType, null).shift()?.value;
        if (!nodeId) { // search for a view instead
            nodeId = store.getObjects(null, this.treeView, null).shift()?.value;
        }

        if (!nodeId) return undefined;

        const uris = [nodeId];

        const ldesId = store.getSubjects(this.rdfType, this.ldesEventStreamType, null).shift()?.value;
        if (ldesId) uris.push(ldesId);

        const relationLinks = store.getObjects(null, this.treeNode, null);
        relationLinks.forEach(x => uris.push(x.value));

        uris.forEach(uri => {
            const id = DataFactory.namedNode(this.changeOrigin(new URL(uri), this.baseUrl).href)
            
            const oldSubjects = store.getQuads(uri, null, null, null);
            const newSubjects = oldSubjects.map(x => DataFactory.quad(id, x.predicate, x.object, x.graph));
            this.replaceQuads(store, oldSubjects, newSubjects);

            const oldObjects = store.getQuads(null, null, uri, null);
            const newObjects = oldObjects.map(x => DataFactory.quad(x.subject, x.predicate, id, x.graph));
            this.replaceQuads(store, oldObjects, newObjects);
        });

        const fragmentUrl = this.changeOrigin(new URL(nodeId), this.baseUrl);
        return fragmentUrl.href;
    }
		
    public get(fragmentId: string): IFragment | undefined {
        return this.repository.get(fragmentId);
    }

    public get fragmentIds(): string[] {
        return this.repository.keys;
    }

    public removeAllFragments(): number {
        return this.repository.removeAll();
    }

}
