import { describe, it, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareFileMap, zipFiles } from '../../lib/archive.js';
import mock from 'mock-fs';
import esmock from 'esmock';

describe('archive', () => {
  describe('prepareFileMap', () => {
    afterEach(() => {
      mock.restore();
    });

    describe('when deploying local files', () => {
      it('should handle a flat list of files', async () => {
        mock({
          '/fake/dir': {
            'index.js': 'console.log("hello")',
            'package.json': '{ "name": "my-app" }',
          },
        });

        const fileMap = await prepareFileMap(['/fake/dir/index.js', '/fake/dir/package.json']);
        assert.equal(Object.keys(fileMap).length, 2);
        assert.ok(fileMap['index.js']);
        assert.ok(fileMap['package.json']);
        assert.equal(fileMap['index.js'].sourcePath, '/fake/dir/index.js');
        assert.equal(fileMap['package.json'].sourcePath, '/fake/dir/package.json');
        assert.equal(fileMap['index.js'].content, undefined);
        assert.equal(fileMap['package.json'].content, undefined);
      });

      it('should handle a nested directory structure', async () => {
        mock({
          '/fake/dir': {
            'src': {
              'index.js': '',
            },
            'package.json': '',
          },
        });

        const fileMap = await prepareFileMap(['/fake/dir/src/index.js', '/fake/dir/package.json']);
        assert.equal(Object.keys(fileMap).length, 2);
        assert.ok(fileMap['src/index.js']);
        assert.ok(fileMap['package.json']);
      });

      it('should handle a mix of files and directories', async () => {
        mock({
          '/fake/dir': {
            'src': {
              'index.js': '',
            },
            'package.json': '',
          },
        });

        const fileMap = await prepareFileMap(['/fake/dir/src', '/fake/dir/package.json']);
        assert.equal(Object.keys(fileMap).length, 2);
        assert.ok(fileMap['src/index.js']);
        assert.ok(fileMap['package.json']);
      });

      it('should handle files with the same name in different directories', async () => {
        mock({
          '/fake/dir': {
            'src': {
              'index.js': '',
            },
            'lib': {
              'index.js': '',
            },
          },
        });

        const fileMap = await prepareFileMap(['/fake/dir/src/index.js', '/fake/dir/lib/index.js']);
        assert.equal(Object.keys(fileMap).length, 2);
        assert.ok(fileMap['src/index.js']);
        assert.ok(fileMap['lib/index.js']);
      });

      it('should handle WSL path transformations', async () => {
        mock({
          '/mnt/c/fake/dir': {
            'index.js': '',
          },
        });

        const fileMap = await prepareFileMap(['/c/fake/dir/index.js']);
        assert.equal(Object.keys(fileMap).length, 1);
        assert.ok(fileMap['index.js']);
      });
    });

    describe('when deploying a local folder', () => {
      it('should handle a single folder', async () => {
        mock({
          '/fake/dir': {
            'index.js': 'console.log("hello")',
            'package.json': '{ "name": "my-app" }',
          },
        });

        const fileMap = await prepareFileMap(['/fake/dir']);
        assert.equal(Object.keys(fileMap).length, 2);
        assert.ok(fileMap['index.js']);
        assert.ok(fileMap['package.json']);
        assert.equal(fileMap['index.js'].sourcePath, '/fake/dir/index.js');
        assert.equal(fileMap['package.json'].sourcePath, '/fake/dir/package.json');
        assert.equal(fileMap['index.js'].content, undefined);
        assert.equal(fileMap['package.json'].content, undefined);
      });
    });

    describe('when deploying file contents', () => {
      it('should handle a list of file objects', async () => {
        const files = [
          { filename: 'index.js', content: 'console.log("hello")' },
          { filename: 'package.json', content: '{ "name": "my-app" }' },
        ];

        const fileMap = await prepareFileMap(files);
        assert.equal(Object.keys(fileMap).length, 2);
        assert.ok(fileMap['index.js']);
        assert.ok(fileMap['package.json']);
        assert.equal(fileMap['index.js'].content, 'console.log("hello")');
        assert.equal(fileMap['package.json'].content, '{ "name": "my-app" }');
        assert.equal(fileMap['index.js'].sourcePath, undefined);
        assert.equal(fileMap['package.json'].sourcePath, undefined);
      });
    });
  });

  describe('createArchive', () => {
    it('should call archiver.file for files with sourcePath', async () => {
      const fileMap = {
        'index.js': { sourcePath: '/fake/dir/index.js' },
        'package.json': { sourcePath: '/fake/dir/package.json' },
      };

      const archiverMock = {
        file: test.mock.fn(),
        append: test.mock.fn(),
        on: test.mock.fn(),
      };

      const archiverConstructorMock = test.mock.fn(() => archiverMock);

      const { createArchive } = await esmock('../../lib/archive.js', {
        archiver: archiverConstructorMock,
      });

      await createArchive(fileMap);

      assert.equal(archiverConstructorMock.mock.callCount(), 1);
      assert.equal(archiverMock.file.mock.callCount(), 2);
      assert.equal(archiverMock.append.mock.callCount(), 0);
      assert.deepStrictEqual(archiverMock.file.mock.calls[0].arguments, ['/fake/dir/index.js', { name: 'index.js' }]);
      assert.deepStrictEqual(archiverMock.file.mock.calls[1].arguments, ['/fake/dir/package.json', { name: 'package.json' }]);
    });

    it('should call archiver.append for files with content', async () => {
      const fileMap = {
        'index.js': { content: 'console.log("hello")' },
        'package.json': { content: '{ "name": "my-app" }' },
      };

      const archiverMock = {
        file: test.mock.fn(),
        append: test.mock.fn(),
        on: test.mock.fn(),
      };

      const archiverConstructorMock = test.mock.fn(() => archiverMock);

      const { createArchive } = await esmock('../../lib/archive.js', {
        archiver: archiverConstructorMock,
      });

      await createArchive(fileMap);

      assert.equal(archiverConstructorMock.mock.callCount(), 1);
      assert.equal(archiverMock.file.mock.callCount(), 0);
      assert.equal(archiverMock.append.mock.callCount(), 2);
      assert.deepStrictEqual(archiverMock.append.mock.calls[0].arguments, ['console.log("hello")', { name: 'index.js' }]);
      assert.deepStrictEqual(archiverMock.append.mock.calls[1].arguments, ['{ "name": "my-app" }', { name: 'package.json' }]);
    });
  });

  describe('zipFiles', () => {
    afterEach(() => {
      mock.restore();
    });

    it('should throw an error if a file is not found', async () => {
      mock({
        '/fake/dir': {
          'index.js': '',
        },
      });

      await assert.rejects(
        async () => {
          await zipFiles(['/fake/dir/index.js', '/fake/dir/not-found.js']);
        },
        {
          message: 'File or directory not found: /fake/dir/not-found.js',
        }
      );
    });

    it('should set hasDockerfile to true if Dockerfile is in the root', async () => {
      mock({
        '/fake/dir': {
          'Dockerfile': '',
          'index.js': '',
        },
      });

      const { hasDockerfile } = await zipFiles(['/fake/dir/Dockerfile', '/fake/dir/index.js']);
      assert.strictEqual(hasDockerfile, true);
    });

    it('should set hasDockerfile to true if dockerfile (lowercase) is in the root', async () => {
      mock({
        '/fake/dir': {
          'dockerfile': '',
          'index.js': '',
        },
      });

      const { hasDockerfile } = await zipFiles(['/fake/dir/dockerfile', '/fake/dir/index.js']);
      assert.strictEqual(hasDockerfile, true);
    });

    it('should set hasDockerfile to false if Dockerfile is in a subdirectory', async () => {
      mock({
        '/fake/dir': {
          'src': {
            'Dockerfile': '',
          },
          'index.js': '',
        },
      });

      const { hasDockerfile } = await zipFiles(['/fake/dir/src/Dockerfile', '/fake/dir/index.js']);
      assert.strictEqual(hasDockerfile, false);
    });

    it('should set hasDockerfile to false if there is no Dockerfile', async () => {
      mock({
        '/fake/dir': {
          'index.js': '',
        },
      });

      const { hasDockerfile } = await zipFiles(['/fake/dir/index.js']);
      assert.strictEqual(hasDockerfile, false);
    });
  });
});