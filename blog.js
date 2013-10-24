var fs = require('fs');
var path = require('path');

var marked = require('marked');

module.exports = function (config) {
  var postsDirectory = config['posts directory'];
  var cacheTimeout   = +config['cache timeout'] || 0;

  var indexPageSize = +config['index page size'] || 10;

  var cache = {};
  var watchers = {};

  var indexCache = null;

  var renderCache = {
    posts: {},
    index: {},
    rss: {},
    tags: {},
  };

  function isPostAvailable(slug) {
    var obj = cache[slug];

    return obj && obj.cacheTime + cacheTimeout > Date.now();
  }

  function isIndexAvailable() {
    return indexCache && indexCache.cacheTime + cacheTimeout > Date.now();
  }

  function getPost(slug) {
    return cache[slug];
  }

  function getIndex() {
    return indexCache && indexCache.index || undefined;
  }

  function watchPost(slug) {
    var fn = path.join(postsDirectory, slug + '.md');

    var w = watchers[slug];

    if (!w) {
      w = fs.watch(fn, { persistent: false }, function (event) {
        if (event === 'change') {
          loadPost(slug);

        } else {
          // If the file got renamed, we don't care about it anymore.
          w.close();

          delete watchers[slug];

          delete cache[slug];
        }
      });

      watchers[slug] = w;
    }
  }

  function loadPost(slug, callback) {
    var fn = path.join(postsDirectory, slug + '.md');
    var post;

    fs.readFile(fn, { 'encoding': 'utf8' }, function (error, data) {
      if (error) {
        if (callback) {
          callback(error);
        }

      } else {
        post = { slug: slug };

        cache[slug] = post;

        post.cacheTime = Date.now();
        post.data = data;

        if (callback) {
          callback(null, post);
        }

        // Quietly start watching this file.
        watchPost(slug);
      }
    });
  }

  function loadIndex(callback) {
    var index;

    var fn;
    var i;

    function saveIndexToCache() {
      indexCache = {
        index: index,
        cacheTime: Date.now()
      };
    }

    fs.readdir(postsDirectory, function (error, files) {
      var openFilesCount = 0;

      if (error) {
        if (callback) {
          callback(error);
        }

        return;
      }

      index = {};

      files.filter(function (fn) {
        return fn && fn.charAt(0) !== '.' && fn.slice(-3) === '.md';

      }).forEach(function (fn) {
        openFilesCount++;

        fs.open(path.join(postsDirectory, fn), 'r',
        function (error, fd) {
          var buf;

          if (error) {
            if (--openFilesCount === 0) {
              saveIndexToCache();

              if (callback) {
                callback(null, index);
              }
            }
            return;
          }

          buf = new Buffer(1024);

          // Slurp the first 1,024 bytes.
          fs.read(fd, buf, 0, 1024, 0, function (error, bytesRead) {
            var s, obj, slug;

            fs.close(fd);

            openFilesCount--;

            try {
              buf = buf.slice(0, bytesRead);

              s = buf.toString('utf8');

              obj = parsePostData(s);
              slug = fn.slice(0, -3);

              index[slug] = {
                slug: slug,
                meta: obj.meta,

                // Truncated text
                text: obj.text
              };

            } catch (e) {
              console.error(e.stack);
            }

            if (openFilesCount === 0) {
              saveIndexToCache();

              if (callback) {
                callback(null, index);
              }
            }

          });
        });
      });

      if (openFilesCount === 0) {
        saveIndexToCache();

        if (callback) {
          callback(null, index);
        }
      }

    });
  }

  function parsePostData(data) {
    var obj = {
      meta: {},
      text: data
    };

    var i, a, d, s;

    var headers;
    var meta;

    var blankLineIndex = data.indexOf('\n\n');

    if (blankLineIndex != -1) {
      meta = {};

      headers = data.substring(0, blankLineIndex).split('\n');

      for (i in headers) {
        a = headers[i].match(/^([a-zA-Z0-9-]+)\s*:\s*(.*)$/);

        if (a) {
          meta[a[1].toLowerCase()] = a[2];
        }
      }

      if (Object.keys(meta).length === headers.length) {
        // All the "headers" are actual headers, as they all match the header
        // format (see checks above).

        obj.text = data.substring(blankLineIndex + 2);

        if (meta['title']) {
          obj.meta['title'] = meta['title'].replace(/\s*$/, '');
        }

        if (meta['date']) {
          d = new Date(meta['date']);

          if (!isNaN(d.getTime())) {
            // It's a valid date.
            obj.meta['date'] = d;
          }
        }

        if (meta['tags']) {
          a = meta['tags'].split(',');
          a = a.map(function (s) {
            // Trim
            return s.replace(/^\s*/, '').replace(/\s*$/, '');
          });

          obj.meta['tags'] = a.filter(function (s) {
            // Remove duplicates and empty values
            return s && !a[s] && (a[s] = true);
          });
        }

        if ((s = meta['status']) && s === 'draft') {
          obj.meta['status'] = s;
        }

        if (meta['description']) {
          obj.meta['description'] = meta['description'];
        }
      }
    }

    return obj;
  }

  function renderPost(post, res) {
    var html;
    var tokens;

    var obj, date;

    obj = renderCache.posts[post.slug];

    if (!obj || !obj.output || obj.ref !== post) {
      html = {};

      if (!post.text) {
        // If we don't have the text, we haven't parsed this post yet. Do it
        // now.
        obj = parsePostData(post.data);

        post.meta = obj.meta;
        post.text = obj.text;
      }

      tokens = marked.lexer(post.text);

      if (post.meta['title']) {
        html.title = post.meta['title'];

      } else {
        if (tokens && tokens.length > 0 && tokens[0].type === 'heading') {
          // If no title has been specified (usually the case), use the heading
          // as the title.
          html.title = tokens[0].text;
        } else {
          // If there's no heading, use the slug.
          html.title = post.slug;
        }
      }

      html.content = marked.parser(tokens);

      html.description = post.meta['description'] || '';
      html.date = post.meta['date'] || null;
      html.tags = post.meta['tags'] || [];

      html.slug = post.slug;

      res.render('post', html, function (error, output) {
        if (error) {
          throw error;
        }

        if (output.length <= 1024) {
          // Express will generate an ETag and do gzip/deflate only if the
          // output is more than 1,024 bytes (characters?). This may be an
          // acceptable tradeoff in general, but in our case we benefit by
          // trying to meet the threshold anyhow. This is HTML; add whitespace
          // at the end of the document.
          output += Array(1024 + 1 - output.length + 1).join(' ');
        }

        renderCache.posts[post.slug] = {
          html: html,
          output: output,
          ref: post
        };

        res.send(output);
      });

    } else {
      res.send(obj.output);
    }
  }

  function renderIndex(index, res, options) {
    var html;
    var slug, post;
    var rss;
    var page, tag;
    var useCache;

    var obj;

    options = options || {};

    rss = !!options.rss;
    page = !rss && Math.max(1, Math.floor(options.page)) || 1;
    tag = options.tag || '';

    // Paging in RSS?
    // http://tools.ietf.org/html/rfc5005#section-3

    // Only the first page is cached
    useCache = page === 1;

    if (useCache) {
      if (tag) {
        obj = renderCache.tags[tag];
      } else {
        obj = rss ? renderCache.rss : renderCache.index;
      }
    }

    if (!obj || !obj.output || obj.ref !== index) {
      html = {
        entries: [],
      };

      for (slug in index) {
        post = index[slug];

        if (!post.meta['date']) {
          // No date, no listing
          continue;
        }

        if (post.meta['status'] === 'draft') {
          continue;
        }

        if (tag && (!post.meta['tags']
              || post.meta['tags'].indexOf(tag) === -1)) {
          continue;
        }

        html.entries.push({
          slug: post.slug,
          title: post.meta['title'] || post.slug,
          description: post.meta['description'] || '',
          date: post.meta['date']
        });
      }

      // Sort in reverse chronological order
      html.entries = html.entries.sort(function (a, b) {
        return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
      });

      if (!rss) {
        html.tag = tag || null;

        html.page = page;

        html.previousPage = page > 1 ? page - 1 : 0;
        html.nextPage = page < html.entries.length / indexPageSize
          ? page + 1 : 0;

        if (page > 1) {
          html.entries.splice(0, indexPageSize * (page - 1));
        }
      }

      html.entries.splice(indexPageSize);

      // Now that we're down to a few entries, let's try to extract the titles
      // out of the (truncated) Markdown text ...
      html.entries.forEach(function (entry) {
        post = index[entry.slug];

        if (!post.meta['title']) {
          // Note: Because we read only 1,024 bytes of the file, the title
          // could totally get truncated here.
          try {
            tokens = marked.lexer(post.text);
          } catch (e) {
            tokens = null;
          }

          if (tokens && tokens.length > 0 && tokens[0].type === 'heading') {
            entry.title = tokens[0].text;
          }
        }
      });

      if (rss) {
        html.lastBuildDate = new Date();
        html.ttl = Math.ceil(cacheTimeout / (60 * 1000));
      }

      res.render(rss ? 'rss' : 'index', html, function (error, output) {
        if (error) {
          throw error;
        }

        if (useCache) {
          if (tag) {
            renderCache.tags[tag] = {
              html: html,
              output: output,
              ref: index
            };
          } else {
            renderCache[rss ? 'rss' : 'index'] = {
              html: html,
              output: output,
              ref: index
            };
          }
        }

        res.send(output);
      });

    } else {
      res.send(obj.output);
    }
  }

  function handlePostRequest(req, res, next) {
    var slug = req.params.slug;

    if (slug.charAt(0) === '.') {
      next();
      return;
    }

    if (isPostAvailable(slug)) {
      renderPost(getPost(slug), res);

    } else {
      loadPost(slug, function (error, post) {
        if (error) {
          if (error.code === 'ENOENT') {
            next();
          } else {
            next(error);
          }

        } else {
          try {
            renderPost(post, res);

          } catch (e) {
            next(e);
          }
        }
      });
    }
  }

  function handleIndexRequest(req, res, next) {
    var options = {
      rss: res.get('Content-Type') === 'application/rss+xml',
      page: req.query.page,
      tag: req.params.tag,
    };

    if (isIndexAvailable()) {
      renderIndex(getIndex(), res, options);

    } else {
      loadIndex(function (error, index) {
        if (error) {
          next(error);

        } else {
          try {
            renderIndex(index, res, options);

          } catch (e) {
            next(error);
          }
        }
      });
    }
  }

  function handleRssRequest(req, res, next) {
    res.type('application/rss+xml');

    // RSS is just the index with a different MIME type.
    handleIndexRequest(req, res, next);
  }

  return {
    getRoutes: function () {
      return {
        // Entry points
        post:  handlePostRequest,
        index: handleIndexRequest,
        rss:   handleRssRequest,
        tag:   handleIndexRequest,
      };
    },
  };
};

