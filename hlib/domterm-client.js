var maxAjaxInterval = 2000;

DomTerm.simpleLayout = false;

DomTerm.addTitlebar = false;

DomTerm.usingJsMenus = function() {
    // It might make sense to use jsMenus even for Electron.
    // One reason is support multi-key keybindings
    return ! DomTerm.simpleLayout && typeof MenuItem !== "undefined"
        && ! (DomTerm.isElectron() && ! DomTerm.addTitlebar)
        && ! DomTerm.usingQtWebEngine;
}

// Non-zero if we should create each domterm terminal in a separate <iframe>.
// Only relevant when using a layout manager like GoldenLayout.
// Issues with !useIFrame:
// - Potentially less secure (all terminals in same frame).
// - Shared 'id' space.
// - Single selection rather than one per terminal.
// - CORS-related complications (we use a "file:" html file to verify browser
//   has read access, but that file can't load modules from "http:")
// Issues with useFrame:
// - Performance (extra overhead).
// - When using jsMenus with most deskop browsers, menu Copy doesn't work;
//   it does work when !useIFrame. (Menu Paste doesn't work either way.)
// - Popout-window buttons don't work.
// - Minor Qt context-menu glitch: When using iframe, showContextMenu
//   is called *after* the native event handler (see webview.cpp).
// The value 1 means don't use an iframe for the initial window, only
// subsequent ones.  The value 2 means use an iframe for all windows.
// Only using iframe for subsequent windows gives most of the benefits
// with less of the cost, plus it makes no-layout modes more consistent.
DomTerm.useIFrame = ! DomTerm.simpleLayout;

/** Connect using XMLHttpRequest ("ajax") */
function connectAjax(name, prefix="", topNode=null)
{
    var wt = new DTerminal(name);
    if (topNode == null)
        topNode = document.getElementById("domterm");
    var xhr = new XMLHttpRequest();
    var sessionKey = 0;
    var pendingInput = null;
    var ajaxInterval = 200;
    var awaitingAjax = false;
    var timer = null;

    function handleAjaxOpen() {
        if (xhr.readyState === 4) {
            var key = xhr.responseText.replace(/key=/, "");
            wt.initializeTerminal(topNode);
            sessionKey = key;
            requestIO();
        }
    }

    function handleTimeout() {
        timer = null;
        requestIO();
    }

    function handleAjaxIO() {
        if (xhr.readyState === 4) {
	    var dlen = DomTerm._handleOutputData(wt, xhr.response);
            awaitingAjax = false;

            if (pendingInput != null) {
                ajaxInterval = 0;
                requestIO();
            } else {
                if (dlen > 0)
                    ajaxInterval = 0;
                ajaxInterval += 200;
                if (ajaxInterval > maxAjaxInterval)
                    ajaxInterval = maxAjaxInterval;
                timer = setTimeout(handleTimeout, ajaxInterval);
            }
        }
    }
    function requestIO() {
        if (timer != null) {
            clearTimeout(timer);
            timer = null;
        }
        xhr.open("POST", prefix+"io-"+sessionKey);
        xhr.onreadystatechange = handleAjaxIO;
        xhr.responseType = "blob";
        var bytes = pendingInput;
        if (bytes !== null)
            ajaxInterval = 0;
        pendingInput = null;
        xhr.onerror= function(e) {
            wt.close();
        }
        let blob = new Blob(bytes == null ? [] : [bytes]);
        xhr.send(blob);
        awaitingAjax = true;
    }

    function onUnload(evt) {
        var request = new XMLHttpRequest();
        request.open("POST",prefix+"close-"+sessionKey);
        request.send("");
    }
    window.addEventListener("beforeunload", onUnload, false);

    function processInput(bytes) {
        if (pendingInput == null)
            pendingInput = bytes;
        else {
            let buf = new ArrayBuffer(pendingInput.byteLength+bytes.byteLength);
            let narr = new Uint8Array(buf);
            narr.set(pendingInput, 0);
            narr.set(bytes, pendingInput.byteLength);
            pendingInput = narr;
        }
        if (! awaitingAjax) {
            requestIO();
        }
    }
    wt.processInputBytes = processInput;

    xhr.open("POST", prefix+"open.txt");
    xhr.onreadystatechange = handleAjaxOpen;
    xhr.send("VERSION="+JSON.stringify(DomTerm.versionInfo));
}

function setupQWebChannel(channel) {
    var backend = channel.objects.backend;
    DomTerm.showContextMenu = function(options) {
        backend.showContextMenu(options.contextType);
        return false;
    }

    DomTerm.doCopy = function(asHTML=false) {
        if (DomTerm.dispatchTerminalMessage("request-selection", asHTML))
            return;
        DomTerm.valueToClipboard(DTerminal._selectionValue(asHTML));
    }

    DomTerm.valueToClipboard = function(values) {
        backend.setClipboard(values.text, values.html);
        return true;
    }
    DomTerm.settingsHook = function(key, value) {
        backend.setSetting(key, value);
    };
    DomTerm.inputModeChanged = function(term, mode) {
        backend.inputModeChanged(mode);
    }
    if (DomTerm.mainSearchParams.get('qtdocking')) {
        DomTerm.newPane = function(paneOp, options=null, dt=DomTerm.focusedTerm) {
            let url = DomTerm.paneLocation;
            if (typeof options == "number") {
                url += url.indexOf('#') >= 0 ? '&' : '#';
                url += "session-number="+options;
            }
            backend.newPane(paneOp, DomTerm.addLocationParams(url));
        };
    }
    const oldAutoPagerChanged = DomTerm.autoPagerChanged;
    DomTerm.autoPagerChanged = function(term, mode) {
        backend.autoPagerChanged(mode);
        oldAutoPagerChanged(term, mode);
    }
    backend.writeOperatingSystemControl.connect(function(code, text) {
        var dt = DomTerm.focusedTerm;
        if (dt)
            dt.handleOperatingSystemControl(code, text);
    });
    backend.writeInputMode.connect(function(mode) {
        DomTerm.setInputMode(mode);
    });
    backend.reportEventToServer.connect(function(name, data) {
        let dt = DomTerm.focusedTerm;
        if (dt)
            dt.reportEvent(name, data);
    })
    backend.pasteText.connect(function(text) {
        var dt = DomTerm.focusedTerm;
        if (dt)
            dt.pasteText(text);
    });
    backend.layoutAddPane.connect(function(paneOp) {
        DomTerm.newPane(paneOp);
    });
    backend.handleSimpleCommand.connect(function(command) {
        DomTerm.doNamedCommand(command);
    });
    backend.copyAsHTML.connect(function() {
        DomTerm.doCopy(true);
    });
    DomTerm.saveFile = function(data) { backend.saveFile(data); }
    DomTerm.windowClose = function() { backend.windowOp('close'); }
    DomTerm.windowOp = function(opname) { backend.windowOp(opname); }
    DomTerm.setTitle = function(title) {
        backend.setWindowTitle(title == null ? "" : title); };
    DomTerm.sendSavedHtml = function(dt, html) { backend.setSavedHtml(html); }
    DomTerm.openNewWindow = function(dt, options={}) {
        let opts = DomTerm._extractGeometryOptions(options);
        let headless = options['headless'];
        backend.openNewWindow(opts.width, opts.height,
                              opts.position || "",
                              opts.url, !!headless);
    }
};

function viewSavedFile(urlEncoded, contextNode=DomTerm.layoutTop) {
    let url = decodeURIComponent(urlEncoded);
    // Requesting the saved file using a file: URL runs into CORS
    // (Cross-Origin Resource Sharing) restrictions on desktop browsers.
    if (url.startsWith("file:")) {
        url = "http://localhost:"+DomTerm.server_port
            +"/saved-file/"+DomTerm.server_key
            +"/"+url.substring(5);
        return DomTerm.makeIFrameWrapper(url, 'V', contextNode);
    }
    let el = DomTerm.makeElement(DomTerm.freshName());
    el.innerHTML = "<h2>waiting for file data ...</h2>";
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.setRequestHeader("Content-Type", "text/plain");
    xhr.onreadystatechange = function() {
        if (xhr.readyState != 4)
            return;
        var responseText = xhr.responseText;
        if (! responseText) {
            el.innerHTML = "<h2>error loading "+url+"</h2>";
            return;
        }
        el.innerHTML = responseText;
        DomTermLayout.initSaved(el);
    };
    xhr.send("");
    return el;
}

function setupParentMessages1() {
    DomTerm.sendParentMessage = function(command, ...args) {
        window.parent.postMessage({"command": command, "args": args}, "*");
    }
    DomTerm.showFocusedTerm = function(dt) {
        DomTerm.sendParentMessage("domterm-focused"); }
    DomTerm.windowClose = function() {
        DomTerm.sendParentMessage("domterm-close"); }
}
function setupParentMessages2() {
    DomTerm.showContextMenu = function(options) {
        DomTerm.sendParentMessage("domterm-context-menu", options);
        return ! DomTerm.usingQtWebEngine;
    }
}

function createTitlebar(titlebarNode) {
    if (true) {
        let iconNode = document.createElement('img');
        iconNode.setAttribute('src', '/favicon.ico');
        titlebarNode.appendChild(iconNode);
    }
    let titleNode = document.createElement('span');
    titleNode.classList.add('dt-window-title');
    titlebarNode.appendChild(titleNode);
    titleNode.innerText = "DomTerm window";
    DomTerm.setTitle = (title) => { titleNode.innerText = title; };
    if (DomTerm.versions.wry) {
        function drag (e) {
            if (e.target.matches('.dt-titlebar-buttons *'))
                return;
            window.rpc.notify('drag_window');
        };
        titlebarNode.addEventListener('mousedown', drag);
        titlebarNode.addEventListener('touchstart', drag);
    }
    titlebarNode.insertAdjacentHTML('beforeend',
                                    '<span class="dt-titlebar-buttons">'
                                    + '<span title="Minimize" class="dt-titlebar-button" id="dt-titlebar-minimize">&#x25BD;</span>'
                                    + '<span title="Maximize" class="dt-titlebar-button" id="dt-titlebar-maximize">&#x25B3;</span>'
                                    + '<span title="Close" class="dt-titlebar-button" id="dt-titlebar-close">&#x2612;</span></span>');
    titlebarNode.querySelector("#dt-titlebar-minimize")
        .addEventListener('click', (e) => {
            DomTerm.windowOp('minimize');
        });
    titlebarNode.querySelector("#dt-titlebar-maximize")
        .addEventListener('click', (e) => {
            DomTerm.doNamedCommand('toggle-fullscreen');
        });
    titlebarNode.querySelector("#dt-titlebar-close")
        .addEventListener('click', (e) => DomTerm.doNamedCommand('close-window'));
}

function loadHandler(event) {
    //if (DomTermLayout.initialize === undefined || window.GoldenLayout === undefined)
    //DomTerm.useIFrame = false;
    const DomTermLayout = DomTerm._domtermLayout;
    let url = location.href;
    let hash = location.hash.replace(/^#[;]*/, '').replace(/;/g, '&');
    let params = new URLSearchParams(hash);
    DomTerm.mainSearchParams = params;
    let m = params.get('js-verbosity');
    if (m) {
        let v = Number(m);
        if (v >= 0)
            DomTerm.verbosity = v;
    }
    m = params.get('log-string-max');
    if (m) {
        let v = Number(m);
        if (! isNaN(v))
            DomTerm.logStringMax = v;
    }
    m = params.get('log-to-server');
    if (m)
        DomTerm.logToServer = m;
    m = params.get('titlebar');
    if (m) {
        DomTerm.addTitlebar = true;
    }
    DomTerm.layoutTop = document.body;
    if (DomTerm.verbosity > 0)
        DomTerm.log("loadHandler "+url);
    DomTerm.server_port = location.port || DomTerm.server_port;
    DomTerm.topLocation = url;
    let hashPos = url.indexOf('#');
    DomTerm.mainLocation = hashPos < 0 ? url : url.substring(0, hashPos);
    DomTerm.paneLocation = ! DomTerm.useIFrame ? DomTerm.mainLocation
        : "http://localhost:"+DomTerm.server_port+"/simple.html";
    if (! DomTerm.server_key && (m = params.get('server-key')) != null) {
        DomTerm.server_key = m;
    }
    if (DomTerm.usingQtWebEngine && ! DomTerm.isInIFrame()) {
        new QWebChannel(qt.webChannelTransport, setupQWebChannel);
    }
    m = location.hash.match(/atom([^&;]*)/);
    if (m) {
        DomTerm.inAtomFlag = true;
        if (DomTerm.isInIFrame()) {
            setupParentMessages1();
            DomTerm.closeFromEof = function(dt) {
                DomTerm.sendParentMessage("domterm-close-from-eof"); }
        } else {
            DomTerm.sendParentMessage = function(command, ...args) {
                electronAccess.ipcRenderer.sendToHost(command, ...args);
             }
        }
        setupParentMessages2();
        /* Not relevant with new multi-message framework.
        DomTerm.displayInfoMessage = function(contents, dt) {
            DomTerm.sendParentMessage("domterm-status-message", contents);
        }
        */
    }
    let bodyNode = document.getElementsByTagName("body")[0];
    if (! DomTerm.useIFrame || ! DomTerm.isInIFrame()) {
        if (DomTerm.addTitlebar) {
            let titlebarNode = document.createElement('div');
            titlebarNode.classList.add('dt-titlebar');
            bodyNode.appendChild(titlebarNode);
            createTitlebar(titlebarNode);
        }
        if (DomTerm.createMenus && ! DomTerm.simpleLayout)
            DomTerm.createMenus();
    }
    m = location.hash.match(/open=([^&;]*)/);
    var open_encoded = m ? decodeURIComponent(m[1]) : null;
    if (open_encoded) {
        DomTermLayout.initSaved(JSON.parse(open_encoded));
        return;
    }
    let bodyChild = bodyNode.firstElementChild;
    if (bodyChild) {
        let bodyClassList = bodyChild.classList;
        if (bodyClassList.contains('dt-titlebar') || bodyClassList.contains('nwjs-menu')) {
            let wrapTopNode = document.createElement('div');
            wrapTopNode.setAttribute("class", "below-menubar");
            bodyNode.appendChild(wrapTopNode);
            DomTerm.layoutTop = wrapTopNode;
        }
    }
    var layoutInitAlways = false;
    if (DomTerm.useIFrame) {
        if (! DomTerm.isInIFrame()) {
            DomTerm.dispatchTerminalMessage = function(command, ...args) {
                const lcontent = DomTerm._oldFocusedContent;
                if (lcontent && lcontent.contentWindow) {
                    lcontent.contentWindow.postMessage({"command": command,
                                                        "args": args}, "*");
                    return true;
                }
                return false;
            }
            DomTerm.sendChildMessage = function(lcontent, command, ...args) {
                if (lcontent)
                    lcontent.contentWindow.postMessage({"command": command,
                                                        "args": args}, "*");
                else
                    console.log("sending "+command+" to unknow child - ignored");
            }
        } else {
            setupParentMessages1();
            setupParentMessages2();
            DomTerm.setTitle = function(title) {
                DomTerm.sendParentMessage("set-window-title", title); }
        }
    }
    if (top !== window && DomTerm.sendParentMessage) {
        // handled by handleMessage (for iframe pane)
        // *or* handled by atom-domterm.
        DomTerm.setLayoutTitle = function(dt, title, wname) {
            DomTerm.sendParentMessage("domterm-set-title", title, wname);
        };
    }
    // non-null if we need to create a websocket but we have no Terminal
    let no_session = null;
    if ((m = location.hash.match(/view-saved=([^&;]*)/))) {
        viewSavedFile(m[1]);
        no_session = "view-saved";
    } else if ((m = location.hash.match(/browse=([^&;]*)/))) {
        DomTerm.makeIFrameWrapper(decodeURIComponent(m[1]),
                                  'B', DomTerm.layoutTop);
        no_session = "browse";
    }
    if (location.pathname.startsWith("/saved-file/")) {
        DomTerm.initSavedFile(DomTerm.layoutTop.firstChild);
        return;
    }
    let paneParams = new URLSearchParams();
    let copyParams = ['server-key', 'js-verbosity', 'log-string-max',
                      'log-to-server', 'headless', 'qtdocking'];
    for (let i = copyParams.length;  --i >= 0; ) {
        let pname = copyParams[i];
        let pvalue = params.get(pname);
        if (pvalue)
            paneParams.set(pname, pvalue);
    }
    DomTerm.mainLocationParams = paneParams.toString();
    if (DomTerm.useIFrame == 2 && ! DomTerm.isInIFrame()) {
        DomTerm.makeIFrameWrapper(DomTerm.paneLocation/*+location.hash*/);
        return;
    }
    if (DomTerm.loadDomTerm) {
        DomTerm.loadDomTerm();
        return;
    }

    var topNodes = document.getElementsByClassName("domterm");
    if (topNodes.length == 0)
        topNodes = document.getElementsByClassName("domterm-wrapper");
    if (topNodes.length == 0) {
        let name = (DomTerm.useIFrame && window.name) || DomTerm.freshName();
        topNodes = [ DomTerm.makeElement(name) ];
    }
    let query = hash; // location.hash ? location.hash.substring(1).replace(/;/g, '&') : null;
    if (location.search.search(/wait/) >= 0) {
    } else if (location.hash == "#ajax" || ! window.WebSocket) {
        DomTerm.usingAjax = true;
        for (var i = 0; i < topNodes.length; i++)
            connectAjax("domterm", "", topNodes[i]);
    } else {
        if (no_session)
            query = (query ? query + "&" : "") + "no-session=" + no_session;
        var wsurl = DTerminal._makeWsUrl(query);
        for (var i = 0; i < topNodes.length; i++) {
            DTerminal.connectWS(null, wsurl, "domterm",
                                no_session ? null : topNodes[i],
                                no_session);
        }
    }
    if (!DomTerm.inAtomFlag)
        location.hash = "";
    if (layoutInitAlways && ! DomTerm.isInIFrame()) {
        DomTerm.withLayout((m) => m.initialize());
    }

}

DomTerm.handleCommand = function(iframe, command, args) {
    return false;
}

/* Used by atom-domterm or if useIFrame. */
function handleMessage(event) {
    const DomTermLayout = DomTerm._domtermLayout;
    var data = event.data;
    var dt=DomTerm.focusedTerm;
    let iframe = null;
    for (let ch = DomTerm.layoutTop.firstChild; ch != null; ch = ch.nextSibling) {
        if (ch.tagName == "IFRAME" && ch.contentWindow == event.source) {
            iframe = ch;
            break;
        }
    }
    if (data.command && data.args
             && DomTerm.handleCommand(iframe, data.command, data.args))
        return;
    else if (data.command=="handle-output")
        DomTerm._handleOutputData(dt, data.output);
    else if (data.command=="socket-open") { // used by atom-domterm
        dt.reportEvent("VERSION", JSON.stringify(DomTerm.versions));
        dt.reportEvent("DETACH", "");
        dt.initializeTerminal(dt.topNode);
    } else if (data.command=="domterm-context-menu") {
        let options = data.args[0];
        let x = options.clientX;
        let y = options.clientY;
        if (iframe && x !== undefined && y !== undefined) {
            let ibox = iframe.getBoundingClientRect();
            x = x + iframe.clientLeft + ibox.x;
            y = y + iframe.clientTop + ibox.y;
            options = Object.assign({}, options, { "clientX": x, "clientY": y});
        }
        DomTerm._contextOptions = options;
        DomTerm.showContextMenu(options);
    } else if (data.command=="domterm-add-pane") { // in parent from child
        DomTermLayout.addPane(data.args[0], data.args[1], iframe);
    } else if (data.command=="domterm-new-window") { // either direction
        DomTerm.openNewWindow(null, data.args[0]);
    } else if (data.command=="do-command") {
        DomTerm.doNamedCommand(data.args[0], iframe);
    } else if (data.command=="auto-paging") {
            DomTerm.setAutoPaging(data.args[0]);
    } else if (data.command=="domterm-next-pane") {
        if (DomTermLayout.manager)
            DomTermLayout.selectNextPane(data.args[0], iframe);
    } else if (data.command=="set-window-title") {
        DomTerm.setTitle(data.args[0]);
    } else if (data.command=="layout-close") {
        if (DomTermLayout.manager)
            DomTermLayout.layoutClose(iframe,
                                      DomTermLayout._elementToLayoutItem(iframe));
        else
            DomTerm.windowClose();
    } else if(data.command=="save-file") {
        DomTerm.saveFile(data.args[0]);
    } else if (data.command=="focus-event") {
        if (iframe) {
            let originMode = data.args[0];
            DomTerm.withLayout((dl) => {
                if (dl.manager)
                    dl._selectLayoutPane(DomTermLayout._elementToLayoutItem(iframe), originMode);
                else {
                    dl._focusChild(iframe, originMode);
                    DomTermLayout.showFocusedPaneF(iframe);
                }
            });
        }
    } else if (data.command=="domterm-set-title") {
        if (iframe)
            DomTerm.setLayoutTitle(iframe,
                                         data.args[0], data.args[1]);
    } else if (data.command=="set-pid") {
        if (iframe)
            iframe.setAttribute("pid", data.args[0]);
    } else if (data.command=="set-session-number") {
        if (iframe)
            iframe.setAttribute("session-number", data.args[0]);
    } else if (data.command=="set-input-mode") { // message to child
        DomTerm.setInputMode(data.args[0]);
    } else if (data.command=="request-save-file") { // message to child
        DomTerm.doSaveAs();
    } else if (data.command=="set-focused") { // message to child
        let op = data.args[0];
        let dt = DomTerm.focusedTerm;
        if (dt) {
            dt.setFocused(op);
        }
    } else if (data.command=="popout-window") {
        let wholeStack = data.args[0];
        if (iframe) {
            let pane = DomTermLayout._elementToLayoutItem(iframe);
            DomTermLayout.popoutWindow(wholeStack ? pane.parent : pane, null);
        }
    } else if (data.command=="domterm-socket-close") { // message to child
        let dt = DomTerm.focusedTerm;
        if (dt)
            dt.closeConnection();
    } else if (data.command=="request-selection") { // parent to child
        // FIXME rename to doNamedCommand("copy"/"copy-as-html");
        DomTerm.sendParentMessage("value-to-clipboard",
                                   DTerminal._selectionValue(data.args[0]));
    } else if (data.command=="value-to-clipboard") { // in layout-context
        DomTerm.valueToClipboard(data.args[0]);
    } else if (data.command=="copy-selection") { // message to child
        DomTerm.doCopy(data.args[0]);
    } else if (data.command=="open-link") { // message to child
        DomTerm.handleLink(data.args[0]);
    } else
        console.log("received message "+data+" command:"+data.command+" dt:"+ dt);
}

window.addEventListener("load", loadHandler, false);
window.addEventListener("message", handleMessage, false);

(function(geometry) {
    if (geometry)
        window.resizeTo(geometry[1], geometry[2]);
})(location.hash.match(/geometry=([0-9][0-9]*)x([0-9][0-9]*)/));
