import * as RDF from "@rdfjs/types";
import { IFragment, LdesFragmentRepository } from "./ldes-fragment-repository";
import { IFragmentInfo, nsRdf, nsTree } from "./fragment-interfaces";
import { IHeaders } from "./http-interfaces";
import { Store, NamedNode, Quad } from 'n3';

export interface ICreateFragmentOptions { 
    'max-age': number;
}

export class LdesFragmentService {
    constructor(private baseUrl: URL, private repository: LdesFragmentRepository) { }

    public async save(quads: RDF.Quad[], options?: ICreateFragmentOptions | undefined, headers?: IHeaders | undefined): Promise<IFragmentInfo> {
        const store = new Store(quads);
        const fragmentUrl = this.changeOrigins(store);
        const id = fragmentUrl?.href.replace(this.baseUrl.href, '/');
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
        return url;
    }

    private rdfType = nsRdf + 'type';
    private treeNodeType = nsTree + 'Node';
    private treeNode = nsTree + 'node';
    private treeRelation = nsTree + 'relation';

    private replaceEntity(store: Store, oldQuads: RDF.Quad[], newQuads: RDF.Quad[]) {
        store.removeQuads(oldQuads);
        store.addQuads(newQuads);
    }

    private changeOrigins(store: Store) {
        const nodeId = store.getSubjects(this.rdfType, this.treeNodeType, null).shift()?.value;
        if (!nodeId) return undefined;

        const fragmentUrl = this.changeOrigin(new URL(nodeId), this.baseUrl);
        const newSubjectId = new NamedNode(fragmentUrl.href);

        const oldNode = store.getQuads(nodeId, null, null, null);
        const relationIds = store.getObjects(nodeId, this.treeRelation, null);
        const oldRelationLinks = relationIds.flatMap(x => store.getQuads(x, this.treeNode, null, null));

        const newNode = oldNode.map(x => new Quad(newSubjectId, x.predicate, x.object, x.graph));
        this.replaceEntity(store, oldNode, newNode);

        const newRelationLinks = oldRelationLinks.map(x => new Quad(x.subject, x.predicate, new NamedNode(this.changeOrigin(new URL(x.object.value), this.baseUrl).href)));
        this.replaceEntity(store, oldRelationLinks, newRelationLinks);

        return fragmentUrl;
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
