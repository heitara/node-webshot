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
  console.log("status: " + status);
  var data = status.data;
  console.log("content: " + page.content);
  var rects = null;

  if (status === 'fail') {
    page.close();
    phantom.exit(1);
    return;
  }

  if (data instanceof Array) {

    rects = data;
  }
  page.onError = function (msg, trace) {
    console.log(msg);
    trace.forEach(function(item) {
      console.log('  ', item.file, ':', item.line);
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
      console.log("Generation of separate images started...");
      var imageTitle = "Untitled", i = 0, rect = rects[0];

      var close = function() {

        //page.render(path + "00" + i + ".png", {quality: options.quality});
        fs.write(metaInfoFilePath, JSON.stringify(metaInfo), function (err) {
          if (err) {
            console.log('Error while creating file: ' + err);
          }
          console.log("Meta data: " + metaInfo + " is saved.");
        });

        page.close();
        console.log('close');
        phantom.exit(0);
      };


      var clipRect = function(rect) {
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
        console.log(page.renderBase64(options.streamType));
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
      console.log('call');
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
  page.onConsoleMessage = function(msg, lineNum, sourceId) {
    console.log('CONSOLE: ' + msg + ' (from line #' + lineNum + ' in "' + sourceId + '")');
  };
  page.onCallback = function(data) {
    takeScreenshot(data);
    //console.log(data);
  };

  if (options.takeShotOnCallback) {

    console.log("test was sent!");
    //application/x-www-form-urlencoded
    console.log(JSON.stringify(settings));
    console.log(site);
    //page.viewportSize = {
    //  width: 1600;
    //  height: 3000;
    //};
    //page.zoomFactor = 0.25;
    page.open(site, settings, function(status) {
      if (status === 'success') {
        //page.evaluate(function(data) {
        //  $(document.body).css('max-height', 3000);
        //});
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
