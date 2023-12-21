export interface IHeaders { 
    [keyof: string]: any
};

export interface IResponse<TBody> {
    body: TBody;
    status: number;
    headers?: IHeaders | undefined;
}

export interface IGetRequest<TQuery> {
    query: TQuery;
}

export interface IPostRequest<TBody, TQuery = void> {
    body: TBody;
    query?: TQuery;
    headers?: IHeaders;
}

export const mimeJsonLd = 'application/ld+json';
export const mimeTurtle = 'text/turtle';
export const mimeTriples = 'application/n-triples';
export const mimeQuads = 'application/n-quads';
