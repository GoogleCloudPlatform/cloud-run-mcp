from flask import Flask, request

app = Flask(__name__)

@app.route('/')
def hello():
    user = request.args.get('user', 'World')
    return f'Hello {user}'

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
