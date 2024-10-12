# Jolokia api-server

The Jolokia api-server is an express js server that serves an OpenApi defined
api as an overlay to jolokia servers, translating the jolokia answers to json
when needed.

Checkout the api.md file to know more about what operations are currently
supported.

## Dev setup

```
yarn build
yarn start
```

## Documentation generation

After updating the `openapi.yml` file, please make sure to generate the
documentation:

```
yarn run build-api-doc
```

## Production build

1. Build the image:
   ```sh
   docker build -t quay.io/artemiscloud/activemq-artemis-jolokia-api-server:latest .
   ```
2. Push the image to image registry:
   ```sh
   docker push quay.io/artemiscloud/activemq-artemis-jolokia-api-server:latest
   ```

### deploy the service

```sh
./deploy.sh [-i <image> -n]
```

The optional `-i <image>` (or `--image <image>`) argument allows you to pass in
the plugin image. If not specified the default
`quay.io/artemiscloud/activemq-artemis-jolokia-api-server:latest` is
deployed. for example:

```sh
./deploy.sh -i quay.io/<repo-username>/activemq-artemis-jolokia-api-server:1.0.1
```

The `deploy.sh` script uses `oc kustomize` (built-in
[kustomize](https://github.com/kubernetes-sigs/kustomize)) command to configure
and deploy the plugin using resources and patches defined under ./deploy
directory.

To undeploy, run

```sh
./undeploy.sh
```

## Security Model of the API Server

The API Server provides a security model that provides authentication and authorization of incoming clients.
The security can be enabled/disabled (i.e. via `API_SERVER_SECURITY_ENABLED` env var)

### Authentication

The authentication provides api to support:

1. Bearer token authentication default

A clients logs in with its credentials and gets a bearer token (jwt token).

The Authentication is configured via `API_SERVER_AUTH_METHOD` (currently bearer).

#### The login api

The login api is defined in openapi.yml

```yaml
/server/login
```

A client logs in to an api server by sending a POST request to the login path. The request body contains login information.
The request body is a json object which must contain a 'authen-type' property.

```yaml
authen-type: 'basic' (currently supported)
```

Depending on the `authen-type` other properties may be provided. For `basic` type, the `username` and `password` may be provided.

### Authorization

The server uses RBAC (Role Based Access Control). The user/role mapping can be managed by the server locally or on a
remote service (for example a ldap server). It maintains a ACL that defines which roles can access an broker jolokia endpoint.

role-name -> list of permission items (endpoint-list permissions, etc)

for example:

role1 -> endpoint-list: endpoint1 (maybe with some constraints? but it can be restricted on the broker's edit/view constraints), endpoint2 ...
... (more permission types may be added, for example, whether or not allow to configure/modify the endpoint list)

The endpoint list can be configured as such:

endpoint name (e.g. broker0, or endpoint1) -> connection info (e.g. http://localhost:8161, user, password)

### Direct Proxy

Direct Proxy means a client can pass a broker's endpoint info to the api-server in order to access it via the api-server.
Some clients (like spp) run inside a browser that cannot directly call the broker's jolokia's API due to browser restrictions (cors, or http->https constraints, or cert issues if mTLS, that can be overcomed by api-server who run as a node js process), but they know all the access info of an jolokia broker.
