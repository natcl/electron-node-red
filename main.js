
'use strict';
const pkg = require('./package.json');
let options;
if (pkg.hasOwnProperty("NRelectron")) { options = pkg["NRelectron"] }
let packages;
if (pkg.hasOwnProperty("dependencies")) { packages = pkg["dependencies"] }

// Some settings you can edit if you don't set them in package.json
//console.log(options)
const editable = options.editable || false;      // set this to false to create a run only application - no editor/no console
const allowLoadSave = options.allowLoadSave || false; // set to true to allow import and export of flow file
let showMap = options.showMap || false;       // set to true to add Worldmap to the menu
const kioskMode = options.kioskMode || false;   // set to true to start in kiosk mode
const addNodes = options.addNodes || false;      // set to false to block installing extra nodes
let flowfile = options.flowFile || 'electronflow.json'; // default Flows file name - loaded at start

const urldash = "/ui/#/0";          // url for the dashboard page
const urledit = "/red";             // url for the editor page
const urlconsole = "/console.htm";  // url for the console page
const urlmap = "/worldmap";         // url for the worldmap
const nrIcon = "nodered.png"        // Icon for the app in root dir (usually 256x256)

let urlStart = urldash;                      // Start on this page
if (!packages.hasOwnProperty("node-red-dashboard")) { urlStart = urledit; }
if (options.start.toLowerCase() === "editor") { urlStart = urledit; }
if (options.start.toLowerCase() === "map") { urlStart = urlmap; }

if (!packages.hasOwnProperty("node-red-contrib-web-worldmap")) { showMap = false; }

// TCP port to use
//const listenPort = "18880";                           // fix it if you like
const listenPort = parseInt(Math.random()*16383+49152)  // or random ephemeral port

const os = require('os');
const fs = require('fs');
const url = require('url');
const path = require('path');
const http = require('http');
const express = require("express");
const electron = require('electron');
const Store = require('electron-store');
const store = new Store()

var isDev
(async () => { isDev = await import('electron-is-dev'); })()

const {app, Menu, TouchBar} = electron;
const ipc = electron.ipcMain;
const dialog = electron.dialog;
const BrowserWindow = electron.BrowserWindow;
const Tray = electron.Tray;
const { TouchBarButton, TouchBarSpacer } = TouchBar;

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) { console.log("Second instance - quitting."); app.quit(); }

var RED = require("node-red");
var red_app = express();

// Add a simple route for static content served from 'public'
red_app.use("/",express.static("web"));
//red_app.use(express.static(__dirname +"/public"));

// Create a server
var server = http.createServer(red_app);

// Setup user directory and flowfile (if editable)
var userdir = __dirname;
if (editable === true) {
    // if running as raw electron use the current directory (mainly for dev)
    if (process.argv[1] && (process.argv[1] === "main.js")) {
        userdir = __dirname;
        if ((process.argv.length > 2) && ((process.argv[process.argv.length-1].indexOf(".json") > -1)||(process.argv[process.argv.length-1].indexOf(".flow") > -1))) {
            if (path.isAbsolute(process.argv[process.argv.length-1])) {
                flowfile = process.argv[process.argv.length-1];
            }
            else {
                flowfile = path.join(process.cwd(),process.argv[process.argv.length-1]);
            }
            store.set("electronFlow",flowfile)
        }
        else { flowfile = path.join(userdir,flowfile); }
    }
    else { // We set the user directory to be in the users home directory...
        console.log("ARG",process.argv)
        userdir = os.homedir() + '/.node-red';
        if (!fs.existsSync(userdir)) {
            fs.mkdirSync(userdir);
        }
        if ((process.argv.length > 1) && ((process.argv[process.argv.length-1].indexOf(".json") > -1) || (process.argv[process.argv.length-1].indexOf(".flow") > -1))) {
            if (path.isAbsolute(process.argv[process.argv.length-1])) {
                flowfile = process.argv[process.argv.length-1];
            }
            else {
                flowfile = path.join(process.cwd(),process.argv[process.argv.length-1]);
            }
            store.set("electronFlow",flowfile)
        }
        else {
            if (!fs.existsSync(userdir+"/"+flowfile)) {
                fs.writeFileSync(userdir+"/"+flowfile, fs.readFileSync(__dirname+"/"+flowfile));
            }
            let credFile = flowfile.replace(".json","_cred.json");
            if (fs.existsSync(__dirname+"/"+credFile) && !fs.existsSync(userdir+"/"+credFile)) {
                fs.writeFileSync(userdir+"/"+credFile, fs.readFileSync(__dirname+"/"+credFile));
            }
            flowfile = path.join(userdir,flowfile);
        }
    }
}
else { store.clear(); }

flowfile = store.get('electronFlow',flowfile);
var myFlow;
try { myFlow = fs.readFileSync(flowfile).toString() }
catch(e) { myFlow = []; }
if (urlStart == urlmap && myFlow.indexOf("worldmap") == -1) { urlStart = urledit; }
if (urlStart == urldash && myFlow.indexOf("ui_base") == -1) { urlStart = urledit; }
myFlow = null;

// console.log("CWD",process.cwd());
// console.log("DIR",__dirname);
// console.log("UserDir :",userdir);
// console.log("PORT",listenPort);
console.log("Store",app.getPath('userData'))
console.log("FlowFile :",flowfile);

// Keep a global reference of the window objects, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow = null;
let conWindow;
let tray;
let logBuffer = [];
let logLength = 250;    // No. of lines of console log to keep.
const levels = [ "", "fatal", "error", "warn", "info", "debug", "trace" ];

ipc.on('clearLogBuffer', function() { logBuffer = []; });

// Create the settings object - see default settings.js file for other options
var settings = {
    uiHost: "localhost",    // only allow local connections, remove if you want to allow external access
    uiPort: listenPort,
    httpAdminRoot: "/red",  // set to false to disable editor and deploy
    httpNodeRoot: "/",
    userDir: userdir,
    flowFile: flowfile,
    flowFilePretty: true,
    autoInstallModules: true,
    editorTheme: {
        projects:{ enabled:false },
        header: { title: options.productName },
        palette: { editable:addNodes }
    },    // enable projects feature
    functionGlobalContext: { },    // enables global context - add extras ehre if you need them
    functionExternalModules: true,
    logging: {
        websock: {
            level: 'info',
            metrics: false,
            handler: function() {
                return function(msg) {
                    if (editable) {  // No logging if not editable
                        var ts = (new Date(msg.timestamp)).toISOString();
                        ts = ts.replace("Z"," ").replace("T"," ");
                        var line = "";
                        if (msg.type && msg.id) {
                            line = ts+" : ["+levels[msg.level/10]+"] ["+msg.type+":"+msg.id+"] "+msg.msg;
                        }
                        else {
                            line = ts+" : ["+levels[msg.level/10]+"] "+msg.msg;
                        }
                        logBuffer.push(line);
                        if (conWindow) { conWindow.webContents.send('debugMsg', line); }
                        if (logBuffer.length > logLength) { logBuffer.shift(); }
                    }
                }
            }
        }
    }
};
if (!editable) {
    settings.httpAdminRoot = false;
    settings.readOnly = true;
}

// Initialise the runtime with a server and settings
RED.init(server,settings);

// Serve the editor UI from /red (if editable)
if (settings.httpAdminRoot !== false) {
    red_app.use(settings.httpAdminRoot,RED.httpAdmin);
}

// Serve the http nodes UI from /
red_app.use(settings.httpNodeRoot,RED.httpNode);

// Create the Application's main menu
var template = [{
    label: "View",
    submenu: [
        {   label: 'Open Flow',
            accelerator: "Shift+CmdOrCtrl+O",
            click() { openFlow(); }
        },
        {   label: 'Save Flow As',
            accelerator: "Shift+CmdOrCtrl+S",
            click() { saveFlow(); }
        },
        {   type: 'separator' },
        {   label: 'Console',
            accelerator: "Shift+CmdOrCtrl+C",
            click() { createConsole(); }
        },
        {   label: 'Dashboard',
            accelerator: "Shift+CmdOrCtrl+D",
            click() { mainWindow.loadURL("http://localhost:"+listenPort+urldash); }
        },
        {   label: 'Editor',
            accelerator: "Shift+CmdOrCtrl+E",
            click() { mainWindow.loadURL("http://localhost:"+listenPort+urledit); }
        },
        {   label: 'Worldmap',
            accelerator: "Shift+CmdOrCtrl+M",
            click() { mainWindow.loadURL("http://localhost:"+listenPort+urlmap); }
        },
        {   type: 'separator' },
        {   type: 'separator' },
        {   label: 'Documentation',
            click() { electron.shell.openExternal('https://nodered.org/docs') }
        },
        {   label: 'Flows and Nodes',
            click() { electron.shell.openExternal('https://flows.nodered.org') }
        },
        {   label: 'Discourse Forum',
            click() { electron.shell.openExternal('https://discourse.nodered.org/') }
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'quit' }
    ]
}];

if (!showMap) { template[0].submenu.splice(6,1); }

if (!editable) {
    template[0].submenu.splice(3,1);
    template[0].submenu.splice(4,1);
}

if (!allowLoadSave) { template[0].submenu.splice(0,2); }

// Top and tail menu on Mac
if (process.platform === 'darwin') {
    template[0].submenu.unshift({ type: 'separator' });
    template[0].submenu.unshift({ label: "About "+options.productName||"Node-RED Electron", selector: "orderFrontStandardAboutPanel:" });
    template[0].submenu.unshift({ type: 'separator' });
    template[0].submenu.unshift({ type: 'separator' });
}

// Add Dev menu if in dev mode
if (isDev) {
    template.push({
        label: 'Development',
        submenu: [
            { label: 'Reload', accelerator: 'CmdOrCtrl+R',
                click (item, focusedWindow) {
                    if (focusedWindow) focusedWindow.reload()
                }
            },
            { label: 'Toggle Developer Tools',
                accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
                click (item, focusedWindow) {
                    if (focusedWindow) focusedWindow.webContents.toggleDevTools()
                }
            }
        ]
    })
}

function saveFlow() {
    const file_path = dialog.showSaveDialogSync({
        title:"Save Flow As",
        filters:[{ name:'JSON', extensions:['json','flow'] }],
        properties: ["showHiddenFiles"],
        defaultPath: flowfile,
        buttonLabel: "Save Flow"
    });
    if (file_path) {
        var flo = JSON.stringify(RED.nodes.getFlows().flows, null , 2);
        fs.writeFile(file_path, flo, function(err) {
            if (err) { dialog.showErrorBox('Error', err); }
            else {
                store.set("electronFlow",file_path);
                dialog.showMessageBoxSync({
                    icon: nrIcon,
                    message:"Flow file saved as\n\n"+file_path,
                    buttons: ["OK"]
                });
                app.relaunch();
                app.exit();
            }
        });
    }
}

function openFlow() {
    const fileNames = dialog.showOpenDialogSync({
        title:"Load Flow File",
        filters:[{ name:'JSON', extensions:['json','flow'] }],
        properties: ["openFile","showHiddenFiles"],
        defaultPath: flowfile,
        buttonLabel: "Load Flow"
    });
    if (fileNames && fileNames.length > 0) {
        fs.readFile(fileNames[0], 'utf-8', function (err, data) {
            try {
                var flo = JSON.parse(data);
                if (Array.isArray(flo) && (flo.length > 0)) {
                    //RED.nodes.setFlows(flo,"full");
                    store.set("electronFlow",fileNames[0]);
                    app.relaunch();
                    app.exit();
                }
                else {
                    dialog.showErrorBox("Error", "Failed to parse flow file.\n\n  "+fileNames[0]+".\n\nAre you sure it's a flow file ?");
                }
            }
            catch(e) {
                dialog.showErrorBox("Error", "Failed to load flow file.\n\n  "+fileNames[0]);
            }
        });
    }
}

// Create the console log window
function createConsole() {
    if (conWindow) { conWindow.show(); return; }
    // Create the hidden console window
    conWindow = new BrowserWindow({
        title: "Node-RED Console",
        width: 800,
        height: 600,
        icon: path.join(__dirname, nrIcon),
        autoHideMenuBar: true,
        // titleBarStyle: "hidden",
        webPreferences: {
            nodeIntegration: true,
            nativeWindowOpen: true,
            contextIsolation: false
        }
    });
    // conWindow.loadURL(url.format({
    //     pathname: path.join(__dirname, urlconsole),
    //     protocol: 'file:',
    //     slashes: true
    // }))
    conWindow.loadURL(path.join(__dirname, urlconsole));
    conWindow.webContents.on('did-finish-load', () => {
        conWindow.webContents.send('logBuff', logBuffer);
    });
    conWindow.on('closed', () => {
        conWindow = null;
    });
    //conWindow.webContents.openDevTools();
    const touchButton5 = new TouchBarButton({
        label: 'Clear Log',
        backgroundColor: '#640000',
        click: () => { logBuffer = []; conWindow.webContents.send('logBuff', logBuffer); }
    });
    const consoleTouchBar = new TouchBar({
        items: [ touchButton5 ]
    });
    conWindow.setTouchBar(consoleTouchBar);
}

// Create the main browser window
function createWindow() {
    mainWindow = new BrowserWindow({
        title: "Node-RED",
        width: 1024,
        height: 768,
        icon: path.join(__dirname, nrIcon),
        fullscreenable: true,
        autoHideMenuBar: false,
        // titleBarStyle: "hidden",
        kiosk: kioskMode,
        webPreferences: {
            nodeIntegration: false,
            nativeWindowOpen: true
        }
    });

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    if (process.platform !== 'darwin') { mainWindow.setAutoHideMenuBar(true); }
    mainWindow.loadURL(`file://${__dirname}/load.html`);

    mainWindow.webContents.on('did-get-response-details', function(event, status, newURL, originalURL, httpResponseCode) {
        if ((httpResponseCode == 404) && (newURL == ("http://localhost:"+listenPort+urlStart))) {
            setTimeout(mainWindow.webContents.reload, 250);
        }
    });

    // mainWindow.webContents.on('did-finish-load', (a) => {
    //     console.log("FINISHED LOAD",a);
    // });

    mainWindow.webContents.on("new-window", function(e, url, frameName, disposition, option) {
        // if a child window opens... modify any other options such as width/height, etc
        // in this case make the child overlap the parent exactly...
        //console.log("NEW WINDOW",url);
        var w = mainWindow.getBounds();
        option.x = w.x;
        option.y = w.y;
        option.width = w.width;
        option.height = w.height;
    })

    mainWindow.on('close', function(e) {
        const choice = require('electron').dialog.showMessageBoxSync(this, {
            type: 'question',
            icon: nrIcon,
            buttons: ['Yes', 'No'],
            title: 'Confirm',
            message: 'Are you sure you want to quit?'
        });
        if (choice === 1) {
            e.preventDefault();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // If on a Mac add some touchbar buttons...
    if (process.platform === 'darwin') {

        const touchButton1 = new TouchBarButton({
            label: 'Dashboard',
            backgroundColor: '#640000',
            click: () => { mainWindow.loadURL("http://localhost:"+listenPort+urldash); }
        });

        const touchButton2 = new TouchBarButton({
            label: 'Editor',
            backgroundColor: '#640000',
            click: () => { mainWindow.loadURL("http://localhost:"+listenPort+urledit); }
        });

        const touchButton3 = new TouchBarButton({
            label: 'Map',
            backgroundColor: '#640000',
            click: () => { mainWindow.loadURL("http://localhost:"+listenPort+urlmap); }
        });

        const touchButton4 = new TouchBarButton({
            label: 'Console',
            backgroundColor: '#640000',
            click: () => { createConsole(); }
        });

        var items = [ touchButton1 ];
        if (editable) { items.push(touchButton2) }
        if (showMap) { items.push(touchButton3) }
        if (editable) {
            items.push(new TouchBarSpacer({ size: 'flexible' }));
            items.push(touchButton4);
        }

        // Only bother to add buttons if more than one
        if (items.length != 1) {
            const mainTouchBar = new TouchBar({ items: items });
            mainWindow.setTouchBar(mainTouchBar);
        }
    }

    // Start the app full screen
    //mainWindow.setFullScreen(true)

    // Open the DevTools at start
    //mainWindow.webContents.openDevTools();
}

// Create the tray icon and context menu
function createTray() {
    tray = new Tray(path.join(__dirname, "nrtray.png"));
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show',
            click: function() {
                mainWindow.show();
            }
        },
        {
            label: 'Quit',
            click: function() {
                app.quit();
            }
        }
    ]);
    tray.setToolTip('Node-RED Electron application.')
    tray.setContextMenu(contextMenu);
}

// Called when Electron has finished initialization and is ready to create browser windows.
// app.on('ready', () => {
//     createTray()
//     myWindow = createWindow()
// })

app.whenReady().then(() => {
    createTray();
    createWindow();
})

app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
        if (mainWindow.isMinimized()) { mainWindow.restore(); }
        mainWindow.focus();
    }
})

// Quit when all windows are closed.
app.on('window-all-closed', function () {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') { app.quit(); }
});

app.on('activate', function() {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
        createWindow();
        mainWindow.loadURL("http://localhost:"+listenPort+urlStart);
    }
});

if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
        applicationVersion: pkg.version,
        version: pkg.dependencies["node-red"],
        copyright: "Copyright © 2021 "+pkg.author.name,
        credits: "Node-RED and other components are copyright the JS Foundation and other contributors."
    });
    // Don't show in the dock bar if you like
    //app.dock.hide();
}

// Start the Node-RED runtime, then load the inital dashboard page
RED.start().then(function() {
    server.listen(listenPort,"localhost",function() {
        mainWindow.loadURL("http://localhost:"+listenPort+urlStart);
    });
});
