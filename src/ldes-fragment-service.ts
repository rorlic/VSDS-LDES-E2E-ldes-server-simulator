import { JsonObject, TreeRelation } from "./tree-specification";
import { IFragment, LdesFragmentRepository } from "./ldes-fragment-repository";
import { IFragmentInfo } from "./fragment-interfaces";
import { IHeaders, mimeJsonLd } from "./http-interfaces";
import { fetch } from 'undici';

export interface ICreateFragmentOptions { 
    'max-age': number;
}

export class LdesFragmentService {
    constructor(private baseUrl: URL, private repository: LdesFragmentRepository) { }

    private async cacheRemoteContext(url: string) {
        const localId = this.changeOrigin(new URL(url), this.baseUrl).href;
        const id = localId.replace(this.baseUrl.href, '/');

        if (!this.repository.get(id)) {
            const response = await fetch(url, {headers: {accept: mimeJsonLd}});
            if (response.status !== 200) return undefined;
    
            const body = (await response.json()) as JsonObject;
            this.repository.save(id, body, {'content-type': mimeJsonLd})
        }

        return localId;
    }

    private async handleContexts(node: JsonObject) {
        const context = node["@context"];

        if (typeof context === 'string') {
            const localId = await this.cacheRemoteContext(context);
            node["@context"] = localId || context;
        } else if (Array.isArray(context)) {
            const contexts = context as (string | JsonObject)[];
            node["@context"] = await Promise.all(contexts.map(async value => typeof value === 'string' 
                ? (await this.cacheRemoteContext(value)) || value 
                : value
            ));
        }
    }

    public async save(node: JsonObject, options?: ICreateFragmentOptions | undefined, headers?: IHeaders | undefined): Promise<IFragmentInfo> {
        await this.handleContexts(node);

        const fragmentUrl: URL = this.changeOrigins(node);
        const id = fragmentUrl.href.replace(this.baseUrl.href, '/');
        headers = this.addCacheControlHeader(options, headers);
        this.repository.save(id, node, headers);
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

    private changeOrigins(node: JsonObject) {
        const fragmentUrl: URL = this.changeOrigin(new URL(node['@id']), this.baseUrl);
        node['@id'] = fragmentUrl.href;
        node['tree:relation']?.forEach((x: TreeRelation) => 
            x['tree:node'] = this.changeOrigin(new URL(x['tree:node']), this.baseUrl).href);
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
