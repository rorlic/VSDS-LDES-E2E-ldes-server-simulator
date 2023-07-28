export interface TreeRelation {
    'tree:node': string;
}

export interface JsonObject {
    [key: string]: any
}

export interface IContextual {
    '@context': string | JsonObject | (string | JsonObject)[];
}

export interface IIdentifiable {
    '@id': string;
}

export interface ITreeRelated extends IContextual, IIdentifiable {
    'tree:relation': TreeRelation[];
}
