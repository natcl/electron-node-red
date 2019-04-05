"use strict";

// Some settings you can edit easily
// Flows file name
const flowfile = "flows.json";
// Start on the dashboard page
const url = "/admin";
// url for the editor page
const urledit = "/admin";
// tcp port to use
const listenPort = "18880"; // Hard code for now
// const listenPort = parseInt(Math.random()*16383+49152) // or random ephemeral port
var argvJson = require('minimist')(process.argv.slice(2))

const os = require("os");
const hostname = `192.168.1.153`;
let headless = argvJson.h;
if (!headless) {
  const electron = require("electron");
  const app = electron.app;
  const BrowserWindow = electron.BrowserWindow;
  const { Menu, MenuItem } = electron;
}

// this should be placed at top of main.js to handle squirrel setup events quickly
if (handleSquirrelEvent()) {
  return;
}

var http = require("http");
var express = require("express");
var RED = require("node-red");

// Create an Express app
var red_app = express();

// TV Stuff
const smartcast = require("vizio-smart-cast");
const tv = new smartcast("192.168.1.211", "Ztc3n5pg1e");

// Sonos stuff

const { Sonos } = require("sonos");
let device = new Sonos("192.168.1.172");
let lastVol;
// Add a simple route for static content served from 'public'
red_app.use(express.static(__dirname + "/public"));
red_app.get("/all_off", function (req, res) {
  tv.control.power.off();
  res.send("Triggered All off route");
});

red_app.get("/all_on", function (req, res) {
  tv.control.power.on();
  res.send("Triggered All on route");
});

red_app.get("/tv/:codeset/:code", function (req, res) {
  let codeset = Number(req.params.codeset);
  let code = Number(req.params.code);

  tv.control.keyCommand(Number(codeset), Number(code), "KEYDOWN");
  res.send("Triggered All on route");
});

red_app.get("/cycle_input", function (req, res) {
  res.send("cycle_input");
});
red_app.get("/volume/:vol", function (req, res) {
  let vol = Number(req.params.vol);
  device.setVolume(vol);

  lastVol = vol;
  res.send("Triggered Volume change");
});

red_app.get("/toggle_pause", function (req, res) {
  res.send(`toggle_pause`);
});
// Create a server
var server = http.createServer(red_app);

var userdir;
if (process.argv[1] && process.argv[1] === "main.js") {
  userdir = __dirname;
} else {
  // We set the user directory to be in the users home directory...
  const fs = require("fs");
  userdir = os.homedir() + "/.node-red";
  if (!fs.existsSync(userdir)) {
    fs.mkdirSync(userdir);
  }
  if (!fs.existsSync(userdir + "/" + flowfile)) {
    fs.writeFileSync(
      userdir + "/" + flowfile,
      fs.readFileSync(__dirname + "/" + flowfile)
    );
  }
}
console.log("Setting UserDir to ", userdir);

// Create the settings object - see default settings.js file for other options
var settings = {
  verbose: true,
  httpAdminRoot: "/admin",
  httpNodeRoot: "/",
  userDir: userdir,
  flowFile: flowfile,
  functionGlobalContext: {
    fetch: require("node-fetch"),
    request: require("request"),
    device: device,
    tv: tv,
    smartcast: require("vizio-smart-cast"),
    turnOffDisplay: require("turn-off-display"),
    cheerio: require("cheerio")
  } // enables global context
};

// Initialise the runtime with a server and settings
RED.init(server, settings);

// Serve the editor UI from /red
red_app.use(settings.httpAdminRoot, RED.httpAdmin);

// Serve the http nodes UI from /api
red_app.use(settings.httpNodeRoot, RED.httpNode);

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false
    },
    title: "Node-RED",
    fullscreenable: true,
    //titleBarStyle: "hidden",
    width: 1024,
    height: 768,
    icon: __dirname + "/nodered.png"
  });

  var webContents = mainWindow.webContents;
  webContents.on("did-get-response-details", function (
    event,
    status,
    newURL,
    originalURL,
    httpResponseCode
  ) {
    if (
      httpResponseCode == 404 &&
      newURL == `${hostname}:` + listenPort + url
    ) {
      setTimeout(webContents.reload, 200);
    }
    // Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  });

  // Open the DevTools.
  //mainWindow.webContents.openDevTools();

  mainWindow.webContents.on("new-window", function (
    e,
    url,
    frameName,
    disposition,
    options
  ) {
    // if a child window opens... modify any other options such as width/height, etc
    // in this case make the child overlap the parent exactly...
    var w = mainWindow.getBounds();
    options.x = w.x;
    options.y = w.y;
    options.width = w.width;
    options.height = w.height;
    //re-use the same child name so all "2nd" windows use the same one.
    //frameName = "child";
  });

  // Emitted when the window is closed.
  mainWindow.on("closed", function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });
}
// Only run if headless is false
if (!headless) {
  // Called when Electron has finished initialization and is ready to create browser windows.
  app.on("ready", createWindow);

  // Quit when all windows are closed.
  app.on("window-all-closed", function () {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", function () {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
      createWindow();
      mainWindow.loadURL(`http://${hostname}:` + listenPort + url);
    }
  });
}

// Start the Node-RED runtime, then load the inital page
RED.start().then(function () {
  server.listen(listenPort, hostname, function () {
    console.log(`Starting Server http://${hostname}:${+listenPort}${url}`);
    if (!headless) mainWindow.loadURL(`http://${hostname}:` + listenPort + url);
  });
});

///////////////////////////////////////////////////////
// All this Squirrel stuff is for the Windows installer
function handleSquirrelEvent() {
  if (process.argv.length === 1) {
    return false;
  }

  const ChildProcess = require("child_process");
  const path = require("path");

  const appFolder = path.resolve(process.execPath, "..");
  const rootAtomFolder = path.resolve(appFolder, "..");
  const updateDotExe = path.resolve(path.join(rootAtomFolder, "Update.exe"));
  const exeName = path.basename(process.execPath);

  const spawn = function (command, args) {
    let spawnedProcess, error;

    try {
      spawnedProcess = ChildProcess.spawn(command, args, { detached: true });
    } catch (error) { }

    return spawnedProcess;
  };

  const spawnUpdate = function (args) {
    return spawn(updateDotExe, args);
  };

  const squirrelEvent = process.argv[1];
  switch (squirrelEvent) {
    case "--squirrel-install":
    case "--squirrel-updated":
      // Optionally do things such as:
      // - Add your .exe to the PATH
      // - Write to the registry for things like file associations and
      //   explorer context menus

      // Install desktop and start menu shortcuts
      spawnUpdate(["--createShortcut", exeName]);

      setTimeout(app.quit, 1000);
      return true;

    case "--squirrel-uninstall":
      // Undo anything you did in the --squirrel-install and
      // --squirrel-updated handlers

      // Remove desktop and start menu shortcuts
      spawnUpdate(["--removeShortcut", exeName]);

      setTimeout(app.quit, 1000);
      return true;

    case "--squirrel-obsolete":
      // This is called on the outgoing version of your app before
      // we update to the new version - it's the opposite of
      // --squirrel-updated

      app.quit();
      return true;
  }
}
