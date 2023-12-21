import { IHeaders } from "http-interfaces";

export interface IAlias {
    original: string;
    alias: string;
}

export interface IRedirection {
    from: string;
    to: string;
}

export interface IStatisticsResponses {
    count: number, 
    at: Date[]
}

export interface IStatistics {
    aliases: string[];
    fragments: string[];
    responses: {[key: string]: IStatisticsResponses};
}

export interface IFragmentId { 
    id: string;
}

export interface IFragmentInfo extends IFragmentId, IHeaders {}

export interface IDeleteAll {
    aliasCount: number;
    fragmentCount: number;
}

export const nsRdf = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const nsRdfs = 'http://www.w3.org/2000/01/rdf-schema#';
export const nsXmlSchema = 'http://www.w3.org/2001/XMLSchema#';
export const nsDcTerms = 'http://purl.org/dc/terms/';
export const nsTree = 'https://w3id.org/tree#';
export const nsLdes = 'https://w3id.org/ldes#';
