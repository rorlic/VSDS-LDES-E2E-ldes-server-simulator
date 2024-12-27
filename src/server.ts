import fastify, { FastifyReply } from 'fastify'
import minimist from 'minimist'
import { LdesFragmentRepository } from './ldes-fragment-repository';
import { ICreateFragmentOptions, LdesFragmentService } from './ldes-fragment-service';
import { LdesFragmentController } from "./ldes-fragment-controller";
import { IResponse, mimeJsonLd, mimeQuads, mimeTriples, mimeTurtle } from './http-interfaces';
import { IAlias } from './fragment-interfaces';
import * as RDF from "@rdfjs/types";
import { Parser } from 'n3';

const args = minimist(process.argv.slice(2));
const silent: boolean = args['silent'] !== undefined;

if (!silent) {
  console.debug("arguments: ", args);
}
const port = args['port'] || 80;
const host = args['host'] || 'localhost';
const baseUrl = new URL(args['baseUrl'] || `http://${host}:${port}`);
const repository = new LdesFragmentRepository();
const service = new LdesFragmentService(baseUrl, repository);
const controller = new LdesFragmentController(service);
const bodyLimit = args['maxBodySize'] || (10 * 1024 * 1024); // 10 MB

const server = fastify({ exposeHeadRoutes: true, bodyLimit: bodyLimit });
server.register(require('@fastify/accepts'));

if (!silent) {
  console.debug("settings: ", {
    ...args,
    port: port,
    host: host,
    baseUrl: baseUrl.toString(),
    maxBodySize: bodyLimit,
  });
}

server.addHook('onResponse', (request, reply, done) => {
  if (!silent) {
    const method = request.method;
    const statusCode = reply.statusCode;
    console.debug(method === 'POST'
      ? `${method} ${request.url} ${request.headers['content-type']} ${statusCode}`
      : `${method} ${request.url} ${statusCode}`);
  }
  done();
});

function respondWith<T>(reply: FastifyReply, response: IResponse<T>) {
  reply.status(response.status).headers(response.headers || {}).send(response.body);
}

server.get('/', async (_request, reply) => {
  respondWith(reply, controller.getStatistics());
});

server.get('/*', async (request, reply) => {
  const baseUrl = new URL(`${request.protocol}://${request.hostname}`);
  const result = await controller.getFragment({ query: { id: request.url } }, baseUrl);
  if (result.status === 302) { // redirect
    respondWith(reply, result);
    return;
  }

  const accepts = (request as any).accepts();
  const contentType = accepts.type([mimeTurtle, mimeTriples, mimeQuads, mimeJsonLd]) || undefined;
  const body = result.body && contentType
    ? (contentType === mimeJsonLd 
      ? await controller.writeJsonLd(result.body) 
      : await controller.writeN3(result.body, contentType)) 
    : '';

  const response = {
    body: body,
    status: !body? 400 : result.status,
    headers: !body ? {} : { ...result.headers, 'content-type': contentType },
  } as IResponse<string>

  respondWith(reply, response);
});

server.addContentTypeParser(mimeJsonLd, { parseAs: 'string' }, async (_:any, body: string) => {
  try {
    const quads = await controller.parseJsonLd(body);
    return quads;
  } catch (err: any) {
    err.statusCode = 400;
    throw err;
  }
})

server.addContentTypeParser([mimeTurtle, mimeTriples, mimeQuads], { parseAs: 'string' }, (request, body: string, done) => {
  try {
    const quads = new Parser({ format: request.headers['content-type'] }).parse(body);
    done(null, quads);
  } catch (err: any) {
    err.statusCode = 400;
    done(err, undefined);
  }
})

const queryStringParams = { type: 'object', properties: { "max-age": { type: 'number', default: false } } };

server.post('/ldes', { schema: { querystring: queryStringParams } }, async (request, reply) => {
  const response = await controller.postFragment({
    body: request.body as RDF.Quad[],
    query: request.query as ICreateFragmentOptions,
    headers: { 'content-type': request.headers['content-type'] }
  });
  respondWith(reply, response);
});

server.post('/alias', async (request, reply) => {
  respondWith(reply, controller.postAlias({ body: request.body as IAlias }));
});

server.delete('/ldes', async (_request, reply) => {
  respondWith(reply, controller.deleteAll());
});

async function closeGracefully(signal: any) {
  if (!silent) {
    console.debug(`Received signal: `, signal);
  }
  await server.close();
  process.exitCode = 0;
}

process.on('SIGINT', closeGracefully);

const options = { port: port, host: host };
server.listen(options, async (err, address) => {
  if (args['seed']) {
    try {
      (await controller.seed(args['seed'])).forEach(x => {
        if (!silent) {
          console.debug(`seeded with file '${x.file}' containing fragment: `, x.fragment);
        }
      });
    } catch (error) {
      console.error(error);
    }
  }

  if (err) {
    console.error(err)
    process.exit(1)
  }
  if (!silent) {
    console.log(`Simulator listening at ${address}`);
  }
});
