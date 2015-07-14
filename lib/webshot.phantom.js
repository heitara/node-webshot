var system = require('system')
    , page = require('webpage').create()
    , fs = require('fs')
    , optUtils = require('./options');

// Read in arguments
var site = system.args[1];
var path = system.args.length == 4 ? null : system.args[2];
var streaming = ((system.args.length == 4 ? system.args[2] : system.args[3]) === 'true');
var options = JSON.parse(system.args.length == 4 ? system.args[3] : system.args[4]);
var metaInfo = [];
var metaInfoFilePath = "images/meta_info.txt";


var failToStderr = function(message) {
  system.stderr.write(message);
  page.close();
  phantom.exit(1);
};

page.viewportSize = {
  width: options.windowSize.width
  , height: options.windowSize.height
};

// Capture JS errors and ignore them
page.onError = function(msg, trace) {};

if (options.errorIfStatusIsNot200) {
  page.onResourceReceived = function(response) {
    // If request to the page is not 200 status, fail.
    if (response.url === site && response.status !== 200) {
      failToStderr('Status must be 200; is ' + response.status);
      return;
    }
  };
}

// Handle cookies
if (Array.isArray(options.cookies)) {
  for (var i=0; i<options.cookies.length; ++i) {
    phantom.addCookie(options.cookies[i]);
  }
}

// Set the phantom page properties
var toOverwrite = optUtils.mergeObjects(
    optUtils.filterObject(options, optUtils.phantomPage)
    , page);

optUtils.phantomPage.forEach(function(key) {
  if (toOverwrite[key]) page[key] = toOverwrite[key];
});

// The function that actually performs the screen rendering
var _takeScreenshot = function(status) {
  var data = status.data;

  var rects = null;

  if (status === 'fail') {
    page.close();
    phantom.exit(1);
    return;
  }

  //if (fs.writeFile) {
  //  fs.writeFile('message.txt', 'Hello Node', function (err) {
  //    if (err) throw err;
  //      log('It\'s saved!');
  //  });
  //}

  if (data instanceof Array) {

    rects = data;
  }
  page.onError = function (msg, trace) {
    log(msg);
    trace.forEach(function(item) {
      log('  ', item.file, ':', item.line);
    });
  };
  phantom.onError = function(msg, trace) {
    var msgStack = ['PHANTOM ERROR: ' + msg];
    if (trace && trace.length) {
      msgStack.push('TRACE:');
      trace.forEach(function(t) {
        msgStack.push(' -> ' + (t.file || t.sourceURL) + ': ' + t.line + (t.function ? ' (in function ' + t.function +')' : ''));
      });
    }
    console.error(msgStack.join('\n'));
    phantom.exit(1);
  };



  // Wait `options.renderDelay` seconds for the page's JS to kick in
  window.setTimeout(function () {

    // Handle customCSS option
    if (options.customCSS) {
      page.evaluate(function(customCSS) {
        var style = document.createElement('style');
        var text  = document.createTextNode(customCSS);
        style.setAttribute('type', 'text/css');
        style.appendChild(text);
        document.head.insertBefore(style, document.head.firstChild);
      }, options.customCSS);
    }

    if (rects) {
      log("Generation of separate images started  ...");
      var imageTitle = "Untitled", i = 0, rect = rects[0];
      log(JSON.stringify(rect));
      log(JSON.stringify(rects));
      var close = function() {

        //page.render(path + "00" + i + ".png", {quality: options.quality});
        fs.write(metaInfoFilePath, JSON.stringify(metaInfo), function (err) {
          if (err) {
            log('Error while creating file: ' + err);
          }
          log("Meta data: " + metaInfo + " is saved.");
        });

        page.close();
        log('close');
        phantom.exit(0);
      };


      var clipRect = function(rect) {
        log(JSON.stringify(rect));
        var imgPath = "images/" + path + "00" + i + ".png";
        page.render(imgPath, {quality: options.quality});

        //TODO: fill the meta data on success
        if (rect.title) {
          imageTitle = rect.title
        }
        var image = {title: imageTitle, opts : {}, path: imgPath};

        metaInfo.push(image);

        i++;

        if (i < rects.length) {
          var rect = rects[i];

          page.clipRect = {
            top: parseInt(rect.top)
            , left: rect.left
            , width: rect.width
            , height: rect.height
          };
          setTimeout(function() {
                clipRect(rect);
              }, 2000
          );
        } else {
          i--;
          setTimeout(close, 2000);
          //phantom.exit(0);
        }
      };
      var rect = rects[i];
      page.clipRect = {
        top: parseInt(rect.top)
        , left: rect.left
        , width: rect.width
        , height: rect.height
      };

      setTimeout(function() {
        clipRect(rect);
      }, 500);
    } else {

      // Set the rectangle of the page to render
      page.viewportSize = {
        width: 1980//, pixelCount(page, 'width', "all")
        , height: 1024//pixelCount(page, 'height', "all")
      };

      //page.clipRect = {
      //  top: options.shotOffset.top + 1500
      //  , left: options.shotOffset.left
      //  , width: pixelCount(page, 'width', options.shotSize.width)
      //  - options.shotOffset.right
      //  , height: pixelCount(page, 'height', options.shotSize.height)
      //  - options.shotOffset.bottom
      //};
      page.clipRect = {
        top: options.shotOffset.top + 1500
        , left: options.shotOffset.left
        , width: pixelCount(page, 'width', options.shotSize.width)
        - options.shotOffset.right
        , height: pixelCount(page, 'height', options.shotSize.height)
        - options.shotOffset.bottom
      };


      // Handle defaultWhiteBackgroud option
      if (options.defaultWhiteBackground) {
        page.evaluate(function () {
          var style = document.createElement('style');
          var text = document.createTextNode('body { background: #fff }');
          style.setAttribute('type', 'text/css');
          style.appendChild(text);
          document.head.insertBefore(style, document.head.firstChild);
        });
      }

      // Render, clean up, and exit
      if (!streaming) {
        page.render(path, {quality: options.quality});
        phantom.exit();
      } else {
        log(page.renderBase64(options.streamType));
      }
    }

  }, options.renderDelay);
}
// Register user-provided callbacks
optUtils.phantomCallback.forEach(function(cbName) {
  var cb = options[cbName];
  if (cbName === 'onCallback' && options.takeShotOnCallback) return;
  if (cbName === 'onLoadFinished' && !options.takeShotOnCallback) return;

  if (cb) {
    page[cbName] = buildEvaluationFn(cb.fn, cb.context);
  }
})
// Avoid overwriting the user-provided onPageLoaded or onCallback options
var takeScreenshot;

if (options.onCallback && options.takeShotOnCallback) {
  takeScreenshot = function(data) {
    buildEvaluationFn(
        options.onCallback.fn
        , options.onCallback.context)(data);

    if (data.action == 'takeShot') {
      log('call');
      _takeScreenshot();
    }
  };
} else if (options.onLoadFinished && !options.takeShotOnCallback) {
  takeScreenshot = function(status) {
    buildEvaluationFn(
        options.onLoadFinished.fn
        , options.onLoadFinished.context)(status);
    _takeScreenshot();
  };
} else {
  takeScreenshot = _takeScreenshot;
}

// Kick off the page loading
if (options.siteType == 'url') {

  var params = site.split('?')[1];

  var settings = {
    operation: "POST",
    encoding: "utf8",
    headers: {
      "Content-Type": "application/json"
    },

    data: JSON.stringify({
      username: "dev",
      password: "devd3v",
      key: "Abcd4",
      url: params
    })
  };

  page.settings.resourceTimeout = 10000;

  page.onResourceTimeout = function(e) {
    log(e.errorCode);
    log(e.errorString);
    log(e.url);
    phantom.exit(1);
  };

  page.onConsoleMessage = function(msg, lineNum, sourceId) {
    log('CONSOLE: ' + msg + ' (from line #' + lineNum + ' in "' + sourceId + '")');
  };
  page.onCallback = function(data) {
    takeScreenshot(data);
    //log(data);
  };
  page.onResourceTimeout = function(request) {
    log("Resource on request: " + JSON.stringify(request) + "timeouted.");
  };

  if (options.takeShotOnCallback) {

    log("test was sent!");
    //application/x-www-form-urlencoded
    log(JSON.stringify(settings));
    log(site);

    page.open(site, settings, function(status) {
      if (status === 'success') {
        log("phantom page successfully opened with url: " + site);
      }
    });
  } else {
    page.open(site, settings, takeScreenshot);
  }
} else {

  try {
    var f = fs.open(site, 'r');
    var pageContent = f.read();
    f.close();

    page[options.takeShotOnCallback
        ? 'onCallback'
        : 'onLoadFinished'] = takeScreenshot;

    page.setContent(pageContent, ''); // set content to be provided HTML
    page.reload();                    // issue reload to pull down any CSS or JS
  } catch (e) {
    console.error(e);
    phantom.exit(1);
  }
}


/*
 * Given a shotSize dimension, return the actual number of pixels in the
 * dimension that phantom should render.
 *
 * @param (Object) page
 * @param (String) dimension
 * @param (String or Number) value
 */
function pixelCount(page, dimension, value) {

  // Determine the page's dimensions
  var pageDimensions = page.evaluate(function(zoomFactor) {
    var body = document.body || {};
    var documentElement = document.documentElement || {};
    return {
      width: Math.max(
          body.offsetWidth
          , body.scrollWidth
          , documentElement.clientWidth
          , documentElement.scrollWidth
          , documentElement.offsetWidth
      ) * zoomFactor
      , height: Math.max(
          body.offsetHeight
          , body.scrollHeight
          , documentElement.clientHeight
          , documentElement.scrollHeight
          , documentElement.offsetHeight
      ) * zoomFactor
    };
  }, options.zoomFactor || 1);

  var x = {
        window: page.viewportSize[dimension]
        , all: pageDimensions[dimension]
      }[value] || value;

  return x;
}


/*
 * Bind the function `fn` to the context `context` in a serializable manner.
 * A tiny bit of a hack.
 *
 * @param (String) fn
 * @param (Object) context
 */
function buildEvaluationFn(fn, context) {
  return function() {
    var args = Array.prototype.slice.call(arguments);
    page.evaluate(function(fn, context, args) {
      eval('(' + fn + ')').apply(context, args);
    }, fn, context, args);
  };
}


function log(message) {
  console.log(message);
  //var logMessage = Date.now() + " : " message;
  //var logMessage = message;
  //var file = fs.open("phantom_log.txt", 'wa');
  //fs.write(file, message, null, function(err) {
  //  if (err) console.log("ERROR !! " + err);
  //  file.close(id, function() {
  //    console.log('success');
  //  })
  //});
}
