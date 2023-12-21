import { ICreateFragmentOptions, LdesFragmentService } from "./ldes-fragment-service";
import * as RDF from "@rdfjs/types";
import { readdir, readFile } from 'node:fs/promises';
import { IGetRequest, IPostRequest, IResponse, mimeJsonLd } from "./http-interfaces";
import { IAlias, IDeleteAll, IFragmentId, IFragmentInfo, IRedirection, IStatistics, IStatisticsResponses, nsDcTerms, nsLdes, nsRdf, nsRdfs, nsTree, nsXmlSchema } from "./fragment-interfaces";
import { Store, Prefixes, WriterOptions, StreamWriter } from 'n3';
import { JsonLdParser } from 'jsonld-streaming-parser';
import { promisifyEventEmitter } from 'event-emitter-promisify';
import { JsonLdSerializer } from "jsonld-streaming-serializer";
import Stream from 'stream';

export class LdesFragmentController {
    private _redirections: { [key: string]: string } = {};
    private _requests: { [key: string]: Date[] } = {};

    private addStatistics(fragmentId: string) {
        let responses = this._requests[fragmentId];
        if (!responses) {
            responses = this._requests[fragmentId] = [];
        }
        responses.push(new Date());
    }

    constructor(private service: LdesFragmentService) { }

    /**
     * Parses JSON-LD content to a quads array.
     * @param content The JSON-LD content
     * @returns An array of RDF.Quad
     */
    public async parseJsonLd(content: string): Promise<RDF.Quad[]> {
        const store = new Store();
        const parser = new JsonLdParser();
        parser.end(content);
        await promisifyEventEmitter(store.import(parser));
        const quads = store.getQuads(null, null, null, null);
        return quads;
    }

    public async writeJsonLd(quads: RDF.Quad[]): Promise<string> {
        const quadStream = Stream.Readable.from(quads);
        const writer = new JsonLdSerializer();
        const chunks: string[] = [];
        await promisifyEventEmitter(writer.import(quadStream).on('data', (chunk: string) => chunks.push(chunk)));
        return chunks.join('');
    }

    private defaultPrefixes = {
        rdf: nsRdf, 
        tree: nsTree, 
        dct: nsDcTerms,
        rdfs: nsRdfs,
        xml: nsXmlSchema,
        ldes: nsLdes,
    } as Prefixes<string>;
  
    public async writeN3(quads: RDF.Quad[], contentType: string): Promise<string> {
        const quadStream = Stream.Readable.from(quads);
        const writer = new StreamWriter({ format: contentType, prefixes: this.defaultPrefixes, end: false } as WriterOptions);
        const chunks: string[] = [];
        await promisifyEventEmitter(writer.import(quadStream).on('data', (chunk: string) => chunks.push(chunk)));
        return chunks.join('');
    }

    /**
     * Stores an LDES fragment, replacing the ID of the fragment and its relations with the local origin.
     * @param request The request with its body containing the fragment which optionally contains relations to other fragments.
     * @returns An IFragmentInfo object with its ID property containing the relative fragment path without the origin.
     */
    public async postFragment(request: IPostRequest<RDF.Quad[], ICreateFragmentOptions>): Promise<IResponse<IFragmentInfo>> {
        const response = await this.service.save(request.body, request.query, request.headers)
        const result = {
            status: response.id ? 201 : 400,
            body: response,
        };
        return result;
    }

    /**
     * Retrieves a fragment with the given fragmentId. If the fragmentIs is an alias it 'redirects'/follows the given alias recursively.
     * @param request A get request with the query containing the ID of the fragment to retrieve.
     * @returns The fragment or undefined.
     */
    public async getFragment(request: IGetRequest<IFragmentId>, baseUrl: URL): Promise<IResponse<RDF.Quad[] | undefined>> {
        const fragmentId = request.query.id;
        let redirection = this._redirections[fragmentId];
        if (redirection) {
            while (this._redirections[redirection]) {
                redirection = this._redirections[redirection] ?? '';
            }
            return {
                status: 302,
                body: undefined,
                headers: { 'Location': new URL(redirection, baseUrl).toJSON() },
            }
        }
        const fragment = fragmentId ? this.service.get(fragmentId) : undefined;
        this.addStatistics(fragmentId);
        return {
            status: fragment === undefined ? 404 : 200,
            body: fragment?.content,
            headers: fragment?.headers,
        }
    }

    /**
     * Retrieves the known aliases and known fragments.
     * @returns An object with the known aliases and known fragments.
     */
    public getStatistics(): IResponse<IStatistics> {
        const responses: { [key: string]: IStatisticsResponses } = {};
        Object.keys(this._requests).forEach(x =>
            responses[x] = ({ count: this._requests[x]?.length, at: this._requests[x] } as IStatisticsResponses));

        return {
            status: 200,
            body: {
                aliases: Object.keys(this._redirections),
                fragments: this.service.fragmentIds,
                responses: responses,
            }
        };
    }

    /**
     * Stores an alias for a given fragment ID, allowing to 'redirect' an alias to its original fragment ID (or another alias).
     * @param request A request defining an alias to an original fragment.
     * @returns An object specifying the recursive 'redirect' that will occur when requesting the alias.
     */
    public postAlias(request: IPostRequest<IAlias>): IResponse<IRedirection> {
        const redirection = request.body;
        const original = this.withoutOrigin(redirection.original);
        const alias = this.withoutOrigin(redirection.alias);
        this._redirections[alias] = original;

        let fragmentId: string = original;
        while (this._redirections[fragmentId]) {
            fragmentId = this._redirections[fragmentId] ?? '';
        }
        return {
            status: 201,
            body: {
                from: alias,
                to: fragmentId
            }
        };
    }

    /**
     * Seeds the simulator with the fragments (.jsonld files) found in the given directory location. 
     * Each file is assumed to contain a fragment and be encoded with UTF-8.
     * @param directoryPath The absolute or relative location of a directory containing fragment files.
     */
    public async seed(directoryPath: string): Promise<{ file: string, fragment: IFragmentInfo }[]> {
        const result: { file: string, fragment: IFragmentInfo }[] = [];
        const files: string[] = await readdir(directoryPath);
        for await (const file of files.filter(x => x.endsWith('.jsonld'))) {
            const content = await readFile(`${directoryPath}/${file}`, { encoding: 'utf-8' });
            const quads = await this.parseJsonLd(content);
            const fragment = await this.service.save(quads, undefined, { 'content-type': mimeJsonLd });
            result.push({ file: file, fragment: fragment });
        }
        return result;
    }

    private withoutOrigin(path: string): string {
        const url = new URL(path);
        return path.replace(`${url.protocol}//${url.host}`, '');
    }

    private removeAllAliasesAndStatistics(): number {
        const count = Object.keys(this._redirections).length;
        this._redirections = {};
        this._requests = {};
        return count;
    }

    /**
     * Removes all aliases, fragments and responses.
     * This allows running multiple tests without having to restart the simulator.
     */
    public deleteAll(): IResponse<IDeleteAll> {
        return {
            status: 200, body: {
                aliasCount: this.removeAllAliasesAndStatistics(),
                fragmentCount: this.service.removeAllFragments(),
            }
        };
    }
}
