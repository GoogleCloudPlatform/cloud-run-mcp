# Cloud Run MCP Server

## Code that can be deployed

Only web servers can be deployed using this MCP server.
The code needs to listen for HTTP reqeusts on the port defined by the $PORT environment variable or 8080.

### Supported languages

- If the code is in Node.js, Python, Go, Java, .NET, PHP, Ruby, a Dockerfile is not needed.
- If the code is in another language, or has any custom dependency needs, a Dockerfile is needed.

### Static-only apps

To deploy static-only applications, create a Dockerfile that serves these static files. For example using `nginx`:

`Dockerfile`

```
FROM nginx:stable

COPY ./static /var/www
COPY ./nginx.conf /etc/nginx/conf.d/default.conf

CMD ["nginx", "-g", "daemon off;"]
```

`nginx.conf`:

```
server {
    listen 8080;
    server_name _;

    root /var/www/;
    index index.html;

    # Force all paths to load either itself (js files) or go through index.html.
    location / {
        try_files $uri /index.html;
    }
}
```

## Google Cloud pre-requisities

The user must have an existing Google Cloud account with billing set up, and ideally an existing Google Cloud project.

If deployment fails because of an access or IAM error, it is likely that the user doesn't have Google Cloud credentials on the local machine.
The user must follow these steps:

1. Install the [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) and authenticate with their Google account.

2. Set up application credentials using the command:
   ```bash
   gcloud auth application-default login
   ```
