import { JsonObject } from "tree-specification";
import { IHeaders } from "./http-interfaces";

export interface IFragment {
    content: JsonObject;
    headers: IHeaders;
}

interface LdesFragmentsDatabase {
    [key: string]: IFragment
}

export class LdesFragmentRepository {
    private _fragments: LdesFragmentsDatabase = {};

    public save(id: string, node: JsonObject, headers: IHeaders) {
        this._fragments[id] = {content: node, headers: headers};
    }

    public get(id: string) : IFragment | undefined {
        return this._fragments[id];
    }

    public get keys(): string[] {
        return Object.keys(this._fragments);
    }

    public removeAll(): number {
        const count = this.keys.length;
        this._fragments = {};
        return count;
    }
}
