/* template design for the dashboard*/
var templates = {
    // Main dashboard
    clients: {
        title: 'Clients',
        icon: 'bi bi-people'
    },
    os: {
        title: 'Operating system',
        icon: 'bi bi-cpu'
    },
    enviroment: {
        title: 'Enviroment',
        icon: 'bi bi-terminal'
    },
    configuration: {
        title: 'TunnelOut configuration',
        icon: 'bi bi-sliders'
    },
    packinfo: {
        title: 'Application/Package',
        icon: 'bi bi-code-square'
    },

    // Client details
    basic: {
        title: 'Basic',
        icon: 'bi bi-info-lg'
    },
    stats: {
        title: 'Statistics',
        icon: 'bi bi-activity'
    },
};

/* what fields to we store pr. client - hostname is minimum :) */
var clientEditSet = {
    hostname : {
        type : 'text',
        name : 'Hostname',
        required : true
    }
}

// Hackish
var noCpus = 0;
var headerModal = null;
var whoismodal = null;
var confirmModal = null;
var clientEditor = null;
var clientTimer = null;
var adminTimer = null;
var isAdmin = false;

var curRefresh = function(){};

// Random generator
const rnd = (() => {
    const gen = (min, max) => max++ && [...Array(max-min)].map((s, i) => String.fromCharCode(min+i));

    const sets = {
        num: gen(48,57),
        alphaLower: gen(97,122),
        alphaUpper: gen(65,90),
        special: [...`~!@#$%^&*()_+-=[]\{}|;:'",./<>?`]
    };

    function* iter(len, set) {
        if (set.length < 1) set = Object.values(sets).flat();
        for (let i = 0; i < len; i++) yield set[Math.random() * set.length|0]
    }

    return Object.assign(((len, ...set) => [...iter(len, set.flat())].join('')), sets);
})();
// Main load
$(function () {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches){
        if (getCookie("darkmode") != '0'){
            toogleDarkMode();
        }
    }else{
        if (getCookie("darkmode") == '1'){
            toogleDarkMode();
        }
    }

    window.addEventListener('popstate', function (e) {
        if (e.state == null || e.state == '/dashboard/') {
            loadAdmin(false);
            return;
        }
        // What type of request
        var cleanUrl = e.state.replace(/\/$/, '');
        var lastPath = cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1);
        loadClient(lastPath, false);
    });

    // What type of request
    var cleanUrl = window.location.pathname.replace(/\/$/, '');
    var lastPath = cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1);
    var cookie = getCookie('authType');

    // Create modal
    whoismodal = new bootstrap.Modal(document.getElementById('whoislookup'));
    headerModal = new bootstrap.Modal(document.getElementById('headerinspect'));
    confirmModal = new bootstrap.Modal(document.getElementById('confirmDialog'));
    clientEditor = new bootstrap.Modal(document.getElementById('clientEditor'));
    document.getElementById('clientEditor').addEventListener('shown.bs.modal', event => {
        // Autofocus
        if ($('#clientEditorFilter')[0].offsetParent != null){
            $('#clientEditorFilter')[0].focus();
        }
        if ($('#clientEditForm')[0].offsetParent != null){
            $('#clientEditForm input')[0].focus();
        }
    })

    if (cookie == 'client') {
        $('a.navbar-brand').on('click', function (event) {
            event.stopImmediatePropagation();
            event.preventDefault();
            loadClient(lastPath, false);
            return false;
        });
    } else {
        isAdmin = true;
        $('a.navbar-brand').on('click', function (event) {
            event.stopImmediatePropagation();
            event.preventDefault();
            loadAdmin(true);
            return false;
        });
    }

    // Get user defined fields for customer data
    if (isAdmin){
        fetchData("userfields.json",function(data){
            if (typeof data === 'object'){
                clientEditSet = Object.assign({}, clientEditSet, data);
            }
        });
    }

    // Security is handle by backend - this is just for easy display
    if (cookie == 'client' || lastPath != 'dashboard') {
        loadClient(lastPath, false);
    } else {
        loadAdmin(false);
    }

    // Generic action buttons in main ui
    $('[data-btnaction]').each(function(idx,field){
        $(field).on('click',function(event){
            eval($(field).data('btnaction'));
            event.preventDefault();
            event.stopPropagation();
            return false;
        });
    });

    // Client editor
    $('#clientTableEditor > tbody').on('click', 'button[data-editaction]', function(event){
        event.stopImmediatePropagation();
        event.preventDefault();

        $('#clientEditor').addClass('confirmOpen');
        var tr = $(this).closest('tr');
        var skey = tr.data('key');
        var hostname = tr.data('userdata').hostname;
        showConfirm('<i class="bi bi-trash me-1"></i>Are you sure you want to delete this client?', '<br>'+hostname+'<br><br>', function (result) {
            $('#clientEditor').removeClass('confirmOpen');
            if (result) {
                apiGeneric('/api/clients/' + hostname, 'DELETE', function (data) {
                    showClientEditor();
                });
            }
        });
        return false;
    }).on('click', 'tr', function(event){
        event.preventDefault();
        event.stopPropagation();
        if (document.getSelection().type == 'Range'){
            return false;
        }
        clientEdit($(this).data('userdata'),$(this).data('key'));
        return false;
    });

    // user editor add new client
    $('#newClient').on('click',function(event){
        clientEdit(null,null);
        event.preventDefault();
        event.stopPropagation();
        return false;
    });
});

function fetchData(url, callbackf) {
    $('#mainSpinner').remove();
    $('#fetchSpinner').removeClass('d-none');

    fetch(url)
        .then(async (response) => {
            const isJson = response.headers.get('content-type')?.includes('application/json');
            const data = isJson ? await response.json() : null;
            $('#fetchSpinner').addClass('d-none');
            if (!response.ok) {
                var error = (data && data.message) || response.status;
                error += ' ' + response.statusText;
                return Promise.reject(error);
            }
            if (typeof callbackf == 'function') {
                callbackf(data);
            }
        })
        .catch((error) => {
            $('#fetchSpinner').addClass('d-none');
            ajaxError('Failed to fetch/process data on: ' + url, error);
            if (typeof callbackf == 'function') {
                callbackf(null);
            }
        });
}

function apiGeneric(url, setmethod, callbackf, payload) {
    $('#mainSpinner').remove();
    $('#fetchSpinner').removeClass('d-none');
    var options = {
        method: setmethod
    }
    if (payload != undefined){
        options['headers'] = {'Content-Type' : 'application/json'};
        options['body'] = JSON.stringify(payload)
    }

    fetch(url, options).then(async (response) => {
        const isJson = response.headers.get('content-type')?.includes('application/json');
        const data = isJson ? await response.json() : await response.text();

        $('#fetchSpinner').addClass('d-none');
        if (!response.ok) {
            var error = (data && data.message) || response.status;
            error += ' ' + response.statusText;
            return Promise.reject(error);
        }
        if (typeof callbackf == 'function') {
            callbackf(data, response.ok);
        }

    }).catch((error) => {
        $('#fetchSpinner').addClass('d-none');
        ajaxError('Failed to call/process the API on: ' + url, error + '\nMethod:' + setmethod);
        if (typeof callbackf == 'function') {
            callbackf(null);
        }
    });
}

function ajaxError(message, tech) {
    $('#alertmsg').addClass('d-none');
    var replaceMent = {
        'message' : message,
        'tech' : tech,
        'time' : new Date().toLocaleString()
    };
    $('#alertmsg [data-alertdata]').each(function(idx,field){
        $(field).html(replaceMent[$(field).data('alertdata')]);
    });
    $('#alertmsg').removeClass('d-none');
}

function showClientEditor(loadClient=''){
    $('#clientEditorTool').removeClass('d-none');
    $('#clientEditor .modal-title span').html('');
    // Reset the table
    $('#clientEditForm').addClass('d-none');
    $('#clientTableEditor tbody').html('');
    $('#clientTableEditor thead').html('');
    $('#clientTableView .dloading').removeClass('d-none');

    // Filter clients input
    $('#clientEditorFilter').off('search keyup').on('search keyup', function (event) {
        filterClients($(this).val(),$('#clientTableEditor'));
    });

    fetchData('/api/clients/', function (data) {
        $('#clientTableView .dloading').addClass('d-none');
        if (data == null){
            return;
        }
        var trhead = $('<tr>').appendTo('#clientTableEditor thead');
        trhead.append('<th class="text-center tdactions sortth"><i class="bi bi-person-fill-check" title="Client online"></i></th>');
        // Make headers for the user editor
        $.each(clientEditSet, function(refKey, refSet){
            trhead.append('<th class="sortth">'+refSet.name+'</th>');
        });
        // user actions
        trhead.append('<th class="text-center tdactions">Delete</th>');

        // Now add each user found
        var trfound = null;
        $.each(data, function (key, usrData) {
            var trdata = $('<tr role="button" title="Edit client" data-key="'+key+'">' );
            trdata.data('userdata',usrData);

            if ('online' in usrData && usrData.online) {
                trdata.append('<td class="text-center" data-blank="2"><i class="bi bi-check-circle-fill text-success"><span class="d-none">a</span></i></td>');
            }else{
                trdata.append('<td class="text-center" data-blank="2"><i class="bi bi-circle-fill text-body-tertiary"><span class="d-none">z</span></i></td>');
            }

            $.each(clientEditSet, function(refKey, refSet){
                if (usrData[refKey] == undefined){
                    trdata.append('<td data-blank="1"></td>');
                }else{
                    var fieldD = usrData[refKey];
                    trdata.append('<td>'+fieldD+'</td>');
                }
            });
            if (loadClient != '' && usrData['hostname'] == loadClient){
                trfound = trdata;
            }

            // user actions
            trdata.append(`<td class="text-center" data-blank="2"><button type="button" title="Delete client" data-editaction="clientTrash" class=" btn btn-sm btn-outline-primary"><i class="bi bi-trash-fill"></i></button></td>`);
            // Append to main
            trdata.appendTo('#clientTableEditor tbody');
        });

        // direct edit
        if (trfound != null){
            $('#clientTableView').addClass('d-none');
            trfound.trigger('click');
        }else{
            $('#clientTableView').removeClass('d-none');
        }
        buildTableSort($('#clientTableEditor'),0);

        // Prefilter with existing filter from main
        if ($('#clientEditorFilter').val() != ""){
            filterClients($('#clientEditorFilter').val(),$('#clientTableEditor'));
        }else if ($('#clientFilter').val() != ""){
            $('#clientEditorFilter').val($('#clientFilter').val());
            filterClients($('#clientFilter').val(),$('#clientTableEditor'));
        }
    });
    clientEditor.show();
}

function clientEdit(data,skey = ''){
    $('#clientEditorTool').addClass('d-none');
    var inner = $('#clientEditForm div.innerEdit');
    $('#clientEditForm fieldset').removeAttr('disabled');
    inner.empty();

    var tokenReq = '';
    var tokenField = 'Change secret/token';
    var tokenFieldPH = 'Leave blank to keep existing token';
    if (skey == null){
        tokenReq = ' required';
        tokenField = 'Secret/token';
        tokenFieldPH = 'Secret/token client for login';
        $('#clientEditor .modal-title span').html(' <i class="bi bi-chevron-right"></i> <i class="bi bi-person-plus-fill me-2"></i>Create new');
    }else{
        if ('hostname' in data){
            $('#clientEditor .modal-title span').html(' <i class="bi bi-chevron-right"></i> ' + data.hostname);
        }
    }

    // Build fields
    var keysnotFound = [];
    if (data != null){
        keysnotFound = Object.keys(data);
    }

    // Fields we have
    $.each(clientEditSet, function(refKey, refSet){
        var curD = '';
        var fieldReg = '';
        // Remove from missing if we have the data
        if (data != null && refKey in data) {
            curD = data[refKey];
            delete keysnotFound[keysnotFound.indexOf(refKey)];
        }
        if ('required' in refSet && refSet.required == true){
            fieldReg = 'required';
        }
        inner.append(`
            <div class="mb-3">
                <label for="uedit_${refKey}" class="form-label">${refSet.name}</label>
                <input type="${refSet.type}" class="form-control" id="uedit_${refKey}" name="${refKey}" value="${curD}" placeholder="${refSet.name}" ${fieldReg}>
            </div>`);
    });

    // Data not found so add them
    $.each(keysnotFound,function(item,val){
        if (val != undefined){
            var fieldReg = '';
            if ('val' in clientEditSet && 'required' in clientEditSet[val] && clientEditSet[val].required == true){
                fieldReg = 'required';
            }
            inner.append(`
            <div class="mb-3">
                <label for="uedit_${val}" class="form-label">${sysToUsrTxt(val)}</label>
                <input type="string" class="form-control" id="uedit_${val}" name="${val}" value="${data[val]}" placeholder="${sysToUsrTxt(val)}" ${fieldReg}>
            </div>`)
        }
    });

    // Add secret token
    inner.append(`
        <label for="uedit_secret" class="form-label">${tokenField}</label>
        <div class="mb-3 input-group">
            <input type="text" autocomplete="one-time-code" class="form-control" id="uedit_secret" name="newsecret" value="" placeholder="${tokenFieldPH}" ${tokenReq}>
            <button class="btn btn-primary" type="button" id="generatesecret" title="Auto generate new secret"><i class="bi bi-shuffle"></i></button>
        </div>`);

    // Generate a "random" secret
    $('#generatesecret').off('click').on('click',function(event){
        $('#uedit_secret').val(rnd(20, rnd.alphaUpper, rnd.alphaLower, rnd.num));
        event.preventDefault();
        event.stopPropagation();
        return false;
    });

    // Back to overview
    $('#clientEditBack').one('click', function (event) {
        showClientEditor();
    });

    // Submit handling
    $('#clientEditForm').off('submit').on('submit', function (event) {
        $(this).addClass('was-validated');
        if (!this.checkValidity()) {
            event.preventDefault();
            event.stopPropagation();
            return false;
        }

        var json = {};
        $('#clientEditForm input').each(function(){
            if ($(this).val().trim() != ""){
                json[$(this).attr('name')] = $(this).val();
            }
        });

        // Update the existing secret?
        if (skey != null){
            json['secret'] = skey;
            if (json['newsecret'] == ""){
                delete json['newsecret'];
            }
        }else{
            json['secret'] = json['newsecret'];
            delete json['newsecret'];
        }

        $('#clientEditForm fieldset').attr('disabled',true);
        // POST it
        var hostname = $('#uedit_hostname').val();
        apiGeneric('/api/clients/' + hostname, 'POST', function (data) {
            showClientEditor();
            loadAdmin(false);
        },json);
        return false;
    }).removeClass('was-validated');
    $('#clientTableView').addClass('d-none');
    $('#clientEditForm').removeClass('d-none');
    $('#clientEditForm input')[0].focus();
}


function loadClient(cPath, pop) {
    $('#clientdashboard').empty();
    if (adminTimer != null) {
        window.clearInterval(adminTimer);
        adminTimer = null;
    }

    // Get data and pop if successfull
    fetchData('/api/tunnels/' + cPath, function (data) {
        if (data == null){
            return;
        }
        if (pop) {
            history.pushState('/dashboard/c/' + cPath, null, '/dashboard/c/' + cPath + '/');
        }
        buildClientDash(data);
    });

    // server status automatic refresh
    if (clientTimer == null) {
        curRefresh = function() {
            fetchData('/api/tunnels/' + cPath, buildClientDash);
        }
        clientTimer = setInterval(curRefresh, 30000);
    }
}

function loadAdmin(pop) {
    if (clientTimer != null) {
        window.clearInterval(clientTimer);
        clientTimer = null;
    }

    // Get data and pop if successfull
    fetchData('/api/status', function (data) {
        if (data == null){
            return;
        }
        if (pop) {
            history.pushState('/dashboard/', null, '/dashboard/');
        }
        buildAdminDash(data);
    });

    // server status automatic refresh
    if (adminTimer == null) {
        curRefresh = function() {
            fetchData('/api/status', buildAdminDash);
        }
        adminTimer = setInterval(curRefresh, 30000);
    }
}

// Quick format system vars
function sysToUsrTxt(str) {
    str = str.replaceAll('_', ' ');
    str = str.charAt(0).toUpperCase() + str.slice(1);
    if (typeof str == 'number') {
        return '';
    }
    return str;
}

function formatData(str) {
    if (typeof str == 'number') {
        return str.toLocaleString();
    }
    if (typeof str == "string" && str.match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/)){
        return buildwhoislink(str);
    }
    return str;
}

function calcMemUsage(obj) {
    var total = obj['total_mem'].replace(' MB', '');
    var free = obj['free_mem'].replace(' MB', '');
    return Math.round(((total - free) / total) * 100);
}

// Wrapper for the worst ui pretty mockery
function specialData(obj, k, parent = null) {
    if (parent == 'os') {
        // Inject a progress bar
        if (k == 'total_mem') {
            var prc = calcMemUsage(obj);
            return ('</li><li class="list-group-item"><div class="progress noRemove" style="height: 20px;"><div id="memgraph" class="progress-bar noRemove" role="progressbar" style="width: ' + prc + '%;">' + prc + '%</div></div></li>');
        }
        if (k == 'cpus') {
            noCpus = obj[k];
        }
    }
    if (parent == 'load_avg') {
        var prc = Math.round((obj[k] / noCpus) * 100);
        return ('<div class="w-100 progress noRemove position-absolute bottom-0 start-50 translate-middle-x" style="height: 2px;"><div class="progress-bar noRemove" role="progressbar" style="width: ' + prc + '%;"></div></div>');
    }

    return '';
}

function updateTime() {
    $('#lastudpated').text(new Date().toLocaleString());
}

// Build main UI/Cards
function buildDashCards(data, target) {
    var noclients = 0;
    var unmapped = Object.keys(data);

    // build by template order
    $.each(templates, function (key, templateSet){
        // Not in template
        if (!(key in data)){
            return true;
        }
        unmapped = unmapped.filter(item => item !== key);
        var dataSet = data[key];

        // Updated cards --------------------
        if ($('#dashcard_' + key).length) {
            // Last 10 client requests is special
            if (target == 'clientdashboard' && key == 'stats') {
                buildRequestTable(dataSet.last10request);
                delete dataSet.last10request;
            }

            // Update clients data/count
            if (target == 'serverdashboard' && key == 'clients') {
                noclients = Object.keys(dataSet).length;
                buildAdminClientList(dataSet);
            } else {
                updateUiItem(key, dataSet);
            }

            // Remove any non updated items
            $('#dashcard_' + key + ' span.udatedata:not(.updated)').parent().remove();

            // continue to the next entry and skip the below updating
            return;
        }

        // Make the new cards --------------------
        if (target == 'serverdashboard' && key == 'clients') {
            var clon = $($('#clientlisttemplate').clone().contents());
        }else{
            var clon = $($('#cardtemplate').clone().contents());
        }
        clon.find('.cardmainicon').addClass(templateSet.icon);
        clon.find('.card-title').text(templateSet.title);

        var listGroup = clon.find('.list-group');

        // Last 10 requests is special
        var updateClientReq=false;
        if (target == 'clientdashboard' && key == 'stats') {
            updateClientReq = dataSet.last10request;
            listGroup.after($($('#requesttemplate').clone().contents()));
            delete dataSet.last10request;
        }

        // createfor clients
        var buildclientlist = false;
        if (target == 'serverdashboard' && key == 'clients') {
            noclients = Object.keys(dataSet).length;
            buildclientlist = true;
        } else {
            // Standard data
            listGroup.append(buildUlItems(dataSet, 0, key));
        }

        // Remove all empty
        clon.find('.removeMe').remove();
        clon.find(':empty:not(i,.noRemove)').remove();
        clon.prop('id', 'dashcard_' + key);
        $('#' + target).append(clon);

        if (updateClientReq !== false){
            buildRequestTable(updateClientReq);
        }
        // Update client data
        if (buildclientlist){
            buildAdminClientList(dataSet);

            // Editor
            $('#editclients').on('click',function(){showClientEditor()});

            // Setup click handlers for all data action
            $('#clientList table').on('click', 'a[data-loadclient]', function() {
                loadClient($(this).data('loadclient'),true);
                event.stopImmediatePropagation();
                event.preventDefault();
                return false;
            }).on('click', 'a[data-disconnectclient]', function(event) {
                disconnectClient($(this).data('disconnectclient'));
                event.stopImmediatePropagation();
                event.preventDefault();
                return false;
            }).on('click', 'a[data-editclient]', function(event) {
                showClientEditor($(this).data('editclient'));
                event.stopImmediatePropagation();
                event.preventDefault();
                return false;
            });
            $('#clientFilter').on('search keyup', function (event) {
                filterClients($(this).val(),$('#clientList table'));
            });
        }

        // "Global" whois lookup
        $('#clientList table, #clientdashboard').on('click', 'a[data-whoislookup]', function(event) {
            whoislookup($(this).data('whoislookup'));
            event.stopImmediatePropagation();
            event.preventDefault();
            return false;
        });
    });

    $('#noclients').html(noclients);

    // Show client filtering?
    if (noclients > 10) {
        $('#clientList').addClass('filter');
        $('#clientFilter').removeClass('d-none');
        filterClients($('#clientFilter').val(),$('#clientList table'));
    } else {
        $('#clientFilter').addClass('d-none');
        $('#clientList').removeClass('filter');
        $('#clientList table tbody tr').removeClass('d-none');
    }

    // Anything not mapped
    if (unmapped.length > 0){
        console.error('Found unused api data: ' + unmapped.toString());
    }

    // Cleanup and update
    $('#' + target + ' span.udatedata.updated').removeClass('updated');
    $('#' + target + ' div.servercard .list-group-item.haschildren:last-child').remove();
    updateTime();
}

function filterClients(keyword,tableid) {
    var tbody = tableid.find('tbody');
    tbody.find('tr').removeAttr('data-filtershow');
    if (keyword == '') {
        tbody.find('tr.norowsfound').remove();
        tbody.find('tr').removeClass('d-none');
        return;
    }
    keyword = keyword.toLowerCase();
    var rowsfound = false;
    tbody.find('tr:not(.norowsfound) td:not([data-blank])').each(function () {
        var trpar = $(this).parent();
        if (trpar.data('filtershow') == 1){
            return true;
        }
        var text = $(this).text().toLowerCase();
        if (text.indexOf(keyword) != -1) {
            rowsfound = true;
            $(this).parent().data('filtershow',1);
            $(this).parent().removeClass('d-none');
        } else {
            $(this).parent().addClass('d-none');
        }
    });
    if (rowsfound == false){
        var safekeyword = $('<div>').text(keyword).html();
        if (!tbody.find('tr.norowsfound').length){
            var colspan = tbody.find('tr:first-child > td').length;
            tbody.append('<tr class="norowsfound pe-none user-select-none"><td colspan="'+colspan+'" class="text-center pb-3 pt-3"><i class="bi bi-binoculars-fill"></i> No matches for <kbd>'+safekeyword+'</kbd></td></tr>');
        }else{
            tbody.find('tr.norowsfound  > td >  kbd').html(safekeyword);
        }
    }else{
        tbody.find('tr.norowsfound').remove();
    }
}

function buildAdminClientList(dataSet) {
    var tbody = $('#clientList').find('tbody');
    tbody.empty();
    if (Object.keys(dataSet).length == 0){
        $('#clientList').addClass('d-none');
        return false;
    }
    // Build the sets
    $.each(dataSet, function (hostname, data) {
        var trow = $(`
            <tr><td><a href="/dashboard/c/` + hostname + `" data-loadclient=` + hostname + ` title="Show client info">` + hostname + `</a></td>
            <td>` + buildwhoislink(data.ip_adr) + `
            <td class="text-end pe-2 tdactions" data-blank="2">
                <div class="btn-group" role="group">
                    <a href="//`+ hostname + '.' + window.location.hostname+`" target="_blank" title="Open client web" class="btn btn-sm btn-outline-primary"><i class="bi bi-window"></a></i>
                    <a href="#" title="Edit client" data-editclient="` + hostname + `" class="btn btn-sm btn-outline-primary"><i class="bi bi-pencil-fill "></a></i>
                    <a href="#" title="Disconnect client" data-disconnectclient="` + hostname + `" class="btn btn-sm btn-outline-primary"><i class="bi bi-door-closed-fill"></i></a>
                </div>
            </td>`);
        tbody.append(trow);
    });
    $('#clientList').removeClass('d-none');

    buildTableSort($('#clientList table'),0);
}

function disconnectClient(hostname){
    showConfirm('<i class="bi bi-door-closed me-1"></i>Confirm disconnect client&hellip;', 'Are you sure you want to disconnect "' + hostname + '"?', function (result) {
        if (result) {
            apiGeneric('/api/tunnels/' + hostname, 'DELETE', function (data) {
                loadAdmin(false);
            });
        }
        event.stopImmediatePropagation();
        event.preventDefault();
        return false;
    });
}

function showConfirm(header, body, callbackf) {
    $('#confirmDialog .modal-title').html(header);
    $('#confirmDialog .modal-body').html(body);
    $('#confirmDialog').data('returnVal', false);
    // Native listner - cash.js does not work with bootstap custom events
    $('#confirmDialogYes').one('click', function () {
        $('#confirmDialog').data('returnVal', true);
        confirmModal.hide();
    });
    document.getElementById('confirmDialog').addEventListener('hidden.bs.modal', function modalListner(event) {
        document.getElementById('confirmDialog').removeEventListener('hidden.bs.modal', modalListner);
        callbackf($('#confirmDialog').data('returnVal'));
    });
    confirmModal.show();
}

function buildRequestTable(dataSet) {
    if (dataSet.length == 0){
        $('#requestTable').addClass('d-none');
        return;
    }
    $('#requestTable tbody, #requestTable thead').empty();

    // make th from data set
    var th = '<tr>';
    Object.keys(dataSet[0]).map(function (key, index) {
        th += '<th>' + sysToUsrTxt(key) + '</th>';
    });
    th += '</tr>';
    $('#requestTable thead').append(th);
    // Container able

    var tbody = $('#requestTable tbody');
    $.each(dataSet, function (x, reqdat) {
        var tr = $('<tr>');
        $.each(reqdat, function (key, celldat) {
            // Show headers
            if (key == 'headers') {
                var headlink = $('<a href="#" class="btn btn-sm btn-outline-primary"><i class="bi bi-card-heading"></i></a>');
                $(headlink).on('click', function (event) {
                    var dlHtml = '<dl class="row">';
                    // Append main data
                    $.each(reqdat, function (keydl, datdl) {
                        if (keydl != 'headers') {
                            dlHtml += '<dt class="col-sm-3">' + sysToUsrTxt(keydl) + '</dt><dd class="col-sm-9 techdata">' + datdl + '</dd></dt>';
                        }
                    });
                    dlHtml += '</dl><hr><dl class="mb-0 row">';
                    // Headers
                    $.each(celldat, function (keydl, datdl) {
                        dlHtml += '<dt class="col-sm-3">' + keydl + '</dt><dd class="col-sm-9 techdata">' + datdl + '</dd></dt>';
                    });
                    dlHtml += '</dl>';
                    $('#headerinspect div.modal-body').html(dlHtml);

                    headerModal.show();
                    event.stopImmediatePropagation();
                    event.preventDefault();
                    return false;
                });
                tr.append($('<td class="text-center tdactions">').append(headlink));
                return true;
            }

            // Format timestamp
            if (key == 'reqTime') {
                celldat = new Date(celldat).toLocaleString();
            }
            if (key == 'ip') {
                celldat = buildwhoislink(celldat);
            }
            tr.append('<td class="techdata">' + celldat + '</td>');
        });
        tbody.append(tr);
    });
}

// Update just values not entire UI
function updateUiItem(parent, data) {
    $.each(data, function (key, dataSet) {
        if (typeof dataSet == 'object') {
            updateUiItem(key, dataSet);
        } else {
            var item = $('#datavalue_' + makeSafeStr(parent) + '_' + makeSafeStr(key));
            if (!item.length) {
                // Todo add item?
                console.log(key + ' not found in dash');
                return false;
            }
            item.addClass('updated');
            if (parent == 'load_avg') {
                var prc = Math.round((dataSet / noCpus) * 100);
                item.next()
                    .find('div.progress-bar')
                    .css('width', prc + '%');
                return true;
            }
            if (key == 'total_mem') {
                var prc = calcMemUsage(data);
                $('#memgraph')
                    .css('width', prc + '%')
                    .text(prc + '%');
                return true;
            }
            item.html(formatData(dataSet));
        }
    });
}

function buildUlItems(obj, level = 0, parent = null) {
    var k;
    var strReturn = '';
    if (obj instanceof Object) {
        for (k in obj) {
            var hasChildren = '';
            if (obj.hasOwnProperty(k) && obj[k].length !== 0 && typeof obj[k] == 'object') {
                hasChildren = ' haschildren';
            }
            strReturn += '<li class="list-group-item d-flex justify-content-between align-items-start ps-' + level + ' datalist-' + level + '' + hasChildren + '">';
            if (!Array.isArray(obj)) {
                strReturn += sysToUsrTxt(k);
            } else {
                if (parent == 'load_avg') {
                    var items = ['1 min.', '5 min.', '15 min.'];
                    strReturn += items[k];
                } else {
                    strReturn += '&nbsp;';
                }
            }
            // find children
            if (hasChildren != '') {
                strReturn += buildUlItems(obj[k], level + 3, k);
            } else {
                strReturn += '<span class="udatedata" id="datavalue_' + makeSafeStr(parent) + '_' + makeSafeStr(k) + '">' + formatData(obj[k]) + '</span>';
                strReturn += specialData(obj, k, parent);
            }
            strReturn += '</li>';
        }
    }
    return strReturn;
}

function buildClientDash(data) {
    if (data == null){
        return;
    }
    $('#serverdashboard').addClass('d-none');
    $('#mainheader').text(data.basic.id+'.'+window.location.hostname);
    buildDashCards(data, 'clientdashboard');
    updateTime();
    $('#clientdashboard').removeClass('d-none');
    if (isAdmin) {
        $('#backBtn').removeClass('d-none');
    }
}

function buildAdminDash(data) {
    if (data == null){
        return;
    }
    $('#backBtn').addClass('d-none');
    $('#clientdashboard').addClass('d-none');
    $('#mainheader').html('<i class="bi bi-shield-check me-1"></i>admin');
    buildDashCards(data, 'serverdashboard');
    updateTime();
    $('#serverdashboard').removeClass('d-none');
}

function getCookie(cname) {
    var name = cname + '=';
    var decodedCookie = decodeURIComponent(document.cookie);
    var ca = decodedCookie.split(';');
    for (var i = 0; i < ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0) == ' ') {
            c = c.substring(1);
        }
        if (c.indexOf(name) == 0) {
            return c.substring(name.length, c.length);
        }
    }
    return '';
}

function makeSafeStr(strv){
    strv = String(strv);
    return strv.replace(/\W/g, '');
}

function toogleDarkMode(){
    var now = new Date();
    var time = now.getTime();
    var expireTime = time + 1000*36000;
    now.setTime(expireTime);

    if ($('html').attr('data-bs-theme') == 'dark'){
        $('html').attr('data-bs-theme','light');
        document.cookie = 'darkmode=0;expires='+now.toUTCString()+';path=/';
    }else{
        $('html').attr('data-bs-theme','dark');
        document.cookie = 'darkmode=1;expires='+now.toUTCString()+';path=/';
    }
    $('i.modeicon').toggleClass('bi-moon bi-sun');
}

// Sort a table ;)
function tableSorter(table,thindx,sortDir){
    thindx = thindx + 1;
    var list = [];
    var blankList = [];
    var tbody = table.find('tbody');
    tbody.find('tr td:nth-child('+thindx+')').each(function(){
        if ($(this).data('blank') == 1){
            blankList.push([$(this).text(),$(this).parent().clone(true)])
            return true;
        }
        list.push([$(this).text(),$(this).parent().clone(true)]);
    });
    list.sort(function(a, b) {
        if (!sortDir){
            if (a[0] > b[0]) {
                return -1;
            }
            if (a[0] < b[0]) {
                return 1;
            }
        }else{
            if (a[0] < b[0]) {
                return -1;
            }
            if (a[0] > b[0]) {
                return 1;
            }
        }
        return 0;
    });
    tbody.empty();
    if (!sortDir){
        $.each(blankList, function(tkey, trdata){
            tbody.append(trdata[1]);
        });
        $.each(list, function(tkey, trdata){
            tbody.append(trdata[1]);
        });
    }else{
        $.each(list, function(tkey, trdata){
            tbody.append(trdata[1]);
        });
        $.each(blankList, function(tkey, trdata){
            tbody.append(trdata[1]);
        });
    }
}
function buildwhoislink(ipadr){
    if (isAdmin){
        return `<a href="#" title="Local Whois lookup" data-whoislookup="` + ipadr + `">` + ipadr + `</a><a href="https://www.whois.com/whois/` + ipadr + `" target="_blank" title="Whois IP lookup external"><i class="ps-1 bi bi-box-arrow-up-right"></i></a>`;
    }else{
        return `<a href="https://www.whois.com/whois/` + ipadr + `" target="_blank" title="Whois IP lookup external">`+ipadr+`<i class="ps-1 bi bi-box-arrow-up-right"></i></a>`;
    }
}

function whoislookup(ipadr){
    fetchData('/api/whoisip/' + ipadr, function (data) {
        if (data == null || ! 'result' in data || data.result == null){
            // Nothing found
            return;
        }
        $('#whoisdata').html(data.result.trim());
        whoismodal.show();
    });
}

function buildTableSort(table,doSort){
    table.each(function(){
        var table = $(this);
        table.find('th').each(function(id,it){
            if ($(this).hasClass('sortth')){
                $(this).off('click touch').on('click touch',function(event){
                    // Dont sort when we have nothing to sort
                    if (table.find('tr.norowsfound').length){
                        return false;
                    }
                    // if not actively sorted when cliccking we don't change sort direction when clicking it
                    if ($(this).hasClass('activesort')){
                        tableSorter(table,id,$(this).hasClass('sortdir'));
                        $(this).toggleClass('sortdir');
                    }else{
                        table.find('th.activesort').removeClass('activesort');
                        tableSorter(table,id,!$(this).hasClass('sortdir'));
                        $(this).addClass('activesort');
                    }
                });
            }
        })
    });

    // Active sorted or not - if already sorted then resort the same way again
    var curItem = $(table).find('th.activesort');
    var curSortIDX = curItem.index();
    if (curSortIDX > -1){
        tableSorter(table,curSortIDX,!curItem.hasClass('sortdir'));
    }else{
        $(table.find('th')[doSort]).trigger('click');
    }
}