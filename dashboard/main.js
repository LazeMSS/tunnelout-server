(function (window, document) {

	var layout   = document.getElementById('layout'),
		menu     = document.getElementById('menu'),
		menuLink = document.getElementById('menuLink'),
		menuList = document.getElementById("menulist");

	function toggleClass(element, className) {
		var classes = element.className.split(/\s+/),
			length = classes.length,
			i = 0;

		for (; i < length; i++) {
			if (classes[i] === className) {
				classes.splice(i, 1);
				break;
			}
		}
		// The className is not found
		if (length === classes.length) {
			classes.push(className);
		}

		element.className = classes.join(' ');
	}

	function toggleAll(e) {
		var active = 'active';

		e.preventDefault();
		toggleClass(layout, active);
		toggleClass(menu, active);
		toggleClass(menuLink, active);
	}

	function handleEvent(e) {
		if (e.target.id === "newlink") {
			return true;
		}
		// Load server status
		if (e.target.dataset.serverstatus != undefined){
			history.pushState('server','server status','#server');
			ajaxGet('/api/status',serverStatus);
		}
		
		// Lookup a client
		if (e.target.dataset.clientlookup != undefined){
			history.pushState(e.target.dataset.clientlookup,'client:'+e.target.dataset.header,'#'+e.target.dataset.header);
			ajaxGet('/api/tunnels/'+e.target.dataset.clientlookup+'/status',buildClientData);
		}
		
		// Lookup requests
		if (e.target.parentElement.dataset.reqlookup != undefined){
			var headbox = document.getElementById("headersdisplay");
			if (headbox != undefined){
				headbox.parentNode.removeChild(headbox);
			}
			document.querySelectorAll("#reqtbl tr.active").forEach(element =>
				element.classList.remove('active')
			);
			e.target.parentElement.classList.add("active");
			document.getElementById('maincontent').insertAdjacentHTML('beforeend','<div id="headersdisplay" class="databox"><h3>Headers: '+dataLookup[e.target.parentElement.dataset.reqlookup].url+'</h3><div>'+recursiveBox(dataLookup[e.target.parentElement.dataset.reqlookup].headers,1)+'</div></div>');
		}

		// Set headers
		if (e.target.dataset.header != undefined){
			if (e.target.dataset.clientlookup != undefined){
				document.getElementById('mainHeader').innerHTML = '<a target="_new" id="newlink" href="'+window.location.protocol + '//'+e.target.dataset.header+'.'+ window.location.host +'">'+e.target.dataset.header+'</a>';
			}else{
				document.getElementById('mainHeader').innerHTML = e.target.dataset.header;
			}
		}
		if (e.target.dataset.subheader != undefined){
			document.getElementById('subHeader').innerHTML = e.target.dataset.subheader;
		}

		// Toggle menu
		if (e.target.id === menuLink.id) {
			return toggleAll(e);
		}

		if (menu.className.indexOf('active') !== -1) {
			return toggleAll(e);
		}
		e.preventDefault();
		return false;
	}

	// Generic handler for clicking items
	document.addEventListener('click', handleEvent);

	// What type of request
	var lastPath = document.location.pathname.split("/").slice(-2,-1);
	var cookie = getCookie('authType');

	// Security is handle by backend - this is just for easy display
	if (cookie == "user" || lastPath != "dashboard"){
		// Build the one requested :)
		buildClientsMenu([lastPath]);
	}else{
		var adminMenu = '<li class="pure-menu-item"><a href="#" data-serverstatus=1 data-header="Server" data-subheader="status" class="pure-menu-link">Server status</a></li>';
		adminMenu += '<li class="pure-menu-heading">Clients</li>';
		menulist.insertAdjacentHTML('beforeend',adminMenu);

	}

	// Click first item
	document.getElementById("menulist").getElementsByClassName('pure-menu-link')[0].click();

}(this, this.document));

// Quick ajax wrapper
function ajaxGet(loadThis,handler){
	var xhr = new XMLHttpRequest();
	xhr.open('GET', loadThis);
	xhr.onload = function() {
		if (xhr.status === 200) {
			var json = JSON.parse(xhr.responseText);
			handler(json);
		}else {
			alert('Request failed.  Returned status of ' + xhr.status);
		}
	};
	xhr.send();
}

// Build server status content
function serverStatus(obj){
	buildClientsMenu(obj.clients);
	var clientLen = obj.clients.length;
	delete obj.clients;
	var htmlStr = recursiveBox({'#_clients':clientLen})+recursiveBox(obj);
	document.getElementById('maincontent').innerHTML = htmlStr;
}

// Hackish recursive display
function recursiveBox(obj,level = 0) {
    var k;
    var strReturn = '';
    if (obj instanceof Object) {
        for (k in obj){
        	var kheader = k.replace(/_/g,' ');
        	kheader = kheader.substring(0, 1).toUpperCase() + kheader.substring(1)
        	if (level == 0){
       			strReturn += '<div class="databox"><h3>'+kheader+"</h3><div>";
       		// Object get headers
       		}else if (!Array.isArray(obj)){
       			strReturn += "<h"+(level+3)+">"+kheader+'</h'+(level+3)+'>';
       		}
       		// find children
            if (obj.hasOwnProperty(k) && obj[k].length !== 0){
                //recursive call to recursiveBox property
                strReturn += recursiveBox(obj[k],level+1);
            }else{
            	strReturn += "<em>blank</em>";
            }
            // Close container
            if (level == 0){
       			strReturn += "</div></div>";
       		}
        }
    } else {

       	strReturn += '<span>'+obj+'</span>';
    };
    return strReturn;
};


function buildClientsMenu(clients){
	// Delete all previous
	document.querySelectorAll(".host-name-link").forEach(element =>
		element.parentNode.removeChild(element)
	);
	// No clients
	var menulist = document.getElementById('menulist');
	if (!clients.length){
		menulist.insertAdjacentHTML('beforeend', '<li class="pure-menu-item host-name-link">&nbsp;&nbsp;<em>None</em></li>');
		return;
	}

	clients.forEach(function(currentValue , index){
		menulist.insertAdjacentHTML('beforeend', '<li class="pure-menu-item host-name-link"><a href="#" class="pure-menu-link" data-clientlookup="'+currentValue+'" data-header="'+currentValue+'" data-subheader="Client status">'+currentValue+'</a></li>');
	});
}

var dataLookup = {};
function buildClientData(data){
	var strReturn = '<div class="databox"><h3>Info</h3><div><h4>Auth enabled</h4><span>'+data.auth+'</span></div><div><h4>Connected sockets</h4><span>'+data.stats.connectedSockets+'</span></div></div>';
	var reqTable = '<div class="databox"><h3>Requests</h3><div><table id="reqtbl" class="noWrap pure-table pure-table-striped pure-table-horizontal"><thead><tr><th>Url</th><th>Status</th><th>Method</th><th>Req. IP</th><th>Time</th></tr></thead><tbody>';
	// Make overview overview
	dataLookup = data.stats.last10request;
	data.stats.last10request.forEach(function(reqv , index){
		reqTable += '<tr class="help" data-reqlookup="'+index+'"><td>'+reqv.url+'</td><td>'+reqv.statusCode+'</td><td>'+reqv.method+'</td><td>'+reqv.ip+'</td><td>'+ new Date(reqv.reqTime).toLocaleString()+'</td></tr>';

	});

	reqTable += "</table></div></div>";
	document.getElementById('maincontent').innerHTML = strReturn+reqTable;
}

function getCookie(cname) {
  var name = cname + "=";
  var decodedCookie = decodeURIComponent(document.cookie);
  var ca = decodedCookie.split(';');
  for(var i = 0; i <ca.length; i++) {
    var c = ca[i];
    while (c.charAt(0) == ' ') {
      c = c.substring(1);
    }
    if (c.indexOf(name) == 0) {
      return c.substring(name.length, c.length);
    }
  }
  return "";
}
