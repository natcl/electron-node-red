
'use strict';

// Some settings you can edit easily
// Flows file name
const flowfile = 'flows.json';
// Start on the dashboard page
const url = "/ui";
// url for the editor page
const urledit = "/admin";
// tcp port to use
//const listenPort = "18880"; // fix it just because
const listenPort = parseInt(Math.random()*16383+49152) // or random ephemeral port

const os = require('os');
const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const {Menu, MenuItem} = electron;

// this should be placed at top of main.js to handle squirrel setup events quickly
if (handleSquirrelEvent()) { return; }

var http = require('http');
var express = require("express");
var RED = require("node-red");

// Create an Express app
var red_app = express();

// TV Stuff
let smartcast = require("vizio-smart-cast");
let tv = new smartcast("192.168.1.152", "Zvsylja7if");

// Sonos stuff

const { Sonos } = require("sonos");
let device = new Sonos("192.168.1.172");
let lastVol;
// Add a simple route for static content served from 'public'
//red_app.use(express.static(__dirname +"/public"));

// Create a server
var server = http.createServer(red_app);

var userdir;
if (process.argv[1] && (process.argv[1] === "main.js")) {
    userdir = __dirname;
}
else { // We set the user directory to be in the users home directory...
    const fs = require('fs');
    userdir = os.homedir() + '/.node-red';
    if (!fs.existsSync(userdir)) {
        fs.mkdirSync(userdir);
    }
    if (!fs.existsSync(userdir+"/"+flowfile)) {
        fs.writeFileSync(userdir+"/"+flowfile, fs.readFileSync(__dirname+"/"+flowfile));
    }
}
console.log("Setting UserDir to ",userdir);

// Create the settings object - see default settings.js file for other options
var settings = {
    verbose: true,
    httpAdminRoot:"/admin",
    httpNodeRoot: "/",
    userDir: userdir,
    flowFile: flowfile,
    functionGlobalContext: { }    // enables global context
};

// Initialise the runtime with a server and settings
RED.init(server,settings);

// Serve the editor UI from /red
red_app.use(settings.httpAdminRoot,RED.httpAdmin);

// Serve the http nodes UI from /api
red_app.use(settings.httpNodeRoot,RED.httpNode);

// Create the Application's main menu
var template = [{
    label: "Application",
    submenu: [
        { role: 'about' },
        { type: "separator" },
        { role: 'quit' }
    ]}, {
    label: 'Node-RED',
    submenu: [
        { label: 'Dashboard',
        accelerator: "Shift+CmdOrCtrl+D",
        click() { mainWindow.loadURL("http://localhost:"+listenPort+url); }
        },
        { label: 'Editor',
        accelerator: "Shift+CmdOrCtrl+E",
        click() { mainWindow.loadURL("http://localhost:"+listenPort+urledit); }
        },
        { type: 'separator' },
        { label: 'Documentation',
        click() { require('electron').shell.openExternal('http://nodered.org/docs') }
        },
        { label: 'Flows and Nodes',
        click() { require('electron').shell.openExternal('http://flows.nodered.org') }
        },
        { label: 'Google group',
        click() { require('electron').shell.openExternal('https://groups.google.com/forum/#!forum/node-red') }
        }
    ]}, {
    label: "Edit",
    submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", selector: "undo:" },
        { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", selector: "redo:" },
        { type: "separator" },
        { label: "Cut", accelerator: "CmdOrCtrl+X", selector: "cut:" },
        { label: "Copy", accelerator: "CmdOrCtrl+C", selector: "copy:" },
        { label: "Paste", accelerator: "CmdOrCtrl+V", selector: "paste:" },
        { label: "Select All", accelerator: "CmdOrCtrl+A", selector: "selectAll:" }
    ]}, {
    label: 'View',
    submenu: [
        { label: 'Reload',
            accelerator: 'CmdOrCtrl+R',
            click(item, focusedWindow) { if (focusedWindow) focusedWindow.reload(); }
        },
        { label: 'Toggle Developer Tools',
            accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
            click(item, focusedWindow) { if (focusedWindow) focusedWindow.webContents.toggleDevTools(); }
        },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'minimize' }
    ]}
];

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
    webContents.on('did-get-response-details', function(event, status, newURL, originalURL, httpResponseCode) {
        if ((httpResponseCode == 404) && (newURL == ("http://localhost:"+listenPort+url))) {
            setTimeout(webContents.reload, 200);
        }
        Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    });

    // Open the DevTools.
    //mainWindow.webContents.openDevTools();

    mainWindow.webContents.on("new-window", function(e, url, frameName, disposition, options) {
        // if a child window opens... modify any other options such as width/height, etc
        // in this case make the child overlap the parent exactly...
        var w = mainWindow.getBounds();
        options.x = w.x;
        options.y = w.y;
        options.width = w.width;
        options.height = w.height;
        //re-use the same child name so all "2nd" windows use the same one.
        //frameName = "child";
    })

    // Emitted when the window is closed.
    mainWindow.on('closed', function() {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        mainWindow = null;
    });
}

// Called when Electron has finished initialization and is ready to create browser windows.
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', function () {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function() {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
        createWindow();
        mainWindow.loadURL("http://127.0.0.1:"+listenPort+url);
    }
});

// Start the Node-RED runtime, then load the inital page
RED.start().then(function() {
    server.listen(listenPort,"127.0.0.1",function() {
        mainWindow.loadURL("http://127.0.0.1:"+listenPort+url);
    });
});

///////////////////////////////////////////////////////
// All this Squirrel stuff is for the Windows installer
function handleSquirrelEvent() {
  if (process.argv.length === 1) {
    return false;
  }

  const ChildProcess = require('child_process');
  const path = require('path');

  const appFolder = path.resolve(process.execPath, '..');
  const rootAtomFolder = path.resolve(appFolder, '..');
  const updateDotExe = path.resolve(path.join(rootAtomFolder, 'Update.exe'));
  const exeName = path.basename(process.execPath);

  const spawn = function(command, args) {
    let spawnedProcess, error;

    try {
      spawnedProcess = ChildProcess.spawn(command, args, {detached: true});
    } catch (error) {}

    return spawnedProcess;
  };

  const spawnUpdate = function(args) {
    return spawn(updateDotExe, args);
  };

  const squirrelEvent = process.argv[1];
  switch (squirrelEvent) {
    case '--squirrel-install':
    case '--squirrel-updated':
      // Optionally do things such as:
      // - Add your .exe to the PATH
      // - Write to the registry for things like file associations and
      //   explorer context menus

      // Install desktop and start menu shortcuts
      spawnUpdate(['--createShortcut', exeName]);

      setTimeout(app.quit, 1000);
      return true;

    case '--squirrel-uninstall':
      // Undo anything you did in the --squirrel-install and
      // --squirrel-updated handlers

      // Remove desktop and start menu shortcuts
      spawnUpdate(['--removeShortcut', exeName]);

      setTimeout(app.quit, 1000);
      return true;

    case '--squirrel-obsolete':
      // This is called on the outgoing version of your app before
      // we update to the new version - it's the opposite of
      // --squirrel-updated

      app.quit();
      return true;
  }
};
