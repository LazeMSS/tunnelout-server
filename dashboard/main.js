var preload = '';
(function (window, document) {

	var layout   = document.getElementById('layout'),
		menu     = document.getElementById('menu'),
		menuLink = document.getElementById('menuLink');

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
		if (e.target.dataset.ajaxget != undefined){
			history.pushState(e.target.dataset.ajaxget,'server status','#server');
			ajaxGet(e.target.dataset.ajaxget,scan);
		}
		if (e.target.dataset.ajaxclient != undefined){
			history.pushState(e.target.dataset.ajaxclient,'client:'+e.target.dataset.header,'#'+e.target.dataset.header);
			ajaxGet(e.target.dataset.ajaxclient,buildClientData);
		}
		if (e.target.parentElement.dataset.reqlookup != undefined){
			var headbox = document.getElementById("headersdisplay");
			if (headbox != undefined){
				headbox.parentNode.removeChild(headbox);
			}
			document.querySelectorAll("#reqtbl tr.active").forEach(element =>
				element.classList.remove('active')
			);
			e.target.parentElement.classList.add("active");
			document.getElementById('maincontent').insertAdjacentHTML('beforeend','<div id="headersdisplay" class="databox"><h3>Headers: '+dataLookup[e.target.parentElement.dataset.reqlookup].url+'</h3><div>'+scan(dataLookup[e.target.parentElement.dataset.reqlookup].headers,1)+'</div></div>');
		}
		if (e.target.dataset.header != undefined){
			document.getElementById('mainHeader').innerHTML = e.target.dataset.header;
		}
		if (e.target.dataset.subheader != undefined){
			document.getElementById('subHeader').innerHTML = e.target.dataset.subheader;
		}
		if (e.target.id === menuLink.id) {
			return toggleAll(e);
		}

		if (menu.className.indexOf('active') !== -1) {
			return toggleAll(e);
		}
		e.preventDefault();
		return false;
	}

	document.addEventListener('click', handleEvent);

	// CLick first item
	var lastPath = document.location.pathname.split("/").slice(-2,-1);
	// main or user dash
	if (lastPath != "dashboard"){
		document.getElementById("menulist").removeChild(document.getElementById("menulist").getElementsByClassName('pure-menu-item')[0]);
		buildHostsMenu([lastPath]);
	}
	preload = location.hash.split('#')[1];
	document.getElementById("menulist").getElementsByClassName('pure-menu-link')[0].click();

}(this, this.document));

function ajaxGet(loadThis,handler){
	var xhr = new XMLHttpRequest();
	xhr.open('GET', loadThis);
	xhr.onload = function() {
		if (xhr.status === 200) {
			var json = JSON.parse(xhr.responseText);
			document.getElementById('maincontent').innerHTML = handler(json);
		}else {
			alert('Request failed.  Returned status of ' + xhr.status);
		}
	};
	xhr.send();
}

// Hackish
function scan(obj,level = 0) {
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
       		if (k == "clients"){
       			buildHostsMenu(obj[k]);
       		}
       		// find children
            if (obj.hasOwnProperty(k) && obj[k].length !== 0){
                //recursive call to scan property
                strReturn += scan(obj[k],level+1);
            }else{
            	strReturn += "<em>blank</em>";
            }
            // Close container
            if (level == 0){
       			strReturn += "</div></div>";
       		}
        }
    } else {
    	/* if (!isNaN(obj)){
    		obj = obj.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    	}*/
       	strReturn += '<span>'+obj+'</span>';
    };
    return strReturn;
};


function buildHostsMenu(hosts){
	document.querySelectorAll(".host-name-link").forEach(element =>
		element.parentNode.removeChild(element)
	);
	var menulist = document.getElementById('menulist');
	if (!hosts.length){
		menulist.insertAdjacentHTML('beforeend', '<li class="pure-menu-item host-name-link">&nbsp;&nbsp;<em>None</em></li>');
		return;
	}
	hosts.forEach(function(currentValue , index){
		var preloadC = '';
		if (preload === currentValue){
			preloadC = "preloadMe";
		}
		menulist.insertAdjacentHTML('beforeend', '<li class="pure-menu-item host-name-link"><a href="#" class="pure-menu-link '+preloadC+'" data-ajaxclient="/api/tunnels/'+currentValue+'/status" data-header="'+currentValue+'" data-subheader="Tunnel status">'+currentValue+'</a></li>');
	});
	if (preload !== undefined && document.getElementById("menulist").getElementsByClassName('preloadMe').length){
		document.getElementById("menulist").getElementsByClassName('preloadMe')[0].click();
		preload = null;
	}
}

var dataLookup = {};
function buildClientData(data){
	var strReturn = '<div class="databox"><h3>Info</h3><div><h4>Auth enabled</h4><span>'+data.auth+'</span></div><div><h4>Connected sockets</h4><span>'+data.stats.connectedSockets+'</span></div></div>';
	var reqTable = '<table id="reqtbl" class="noWrap pure-table pure-table-striped pure-table-horizontal"><thead><tr><th>Url</th><th>Status</th><th>Method</th><th>Req. IP</th><th>Time</th></tr></thead><tbody>';
	// Make overview overview
	dataLookup = data.stats.last10request;
	data.stats.last10request.forEach(function(reqv , index){
		reqTable += '<tr class="help" data-reqlookup="'+index+'"><td>'+reqv.url+'</td><td>'+reqv.statusCode+'</td><td>'+reqv.method+'</td><td>'+reqv.ip+'</td><td>'+ new Date(reqv.reqTime).toLocaleString()+'</td></tr>';

	});

	reqTable += "</table>";
	return strReturn+reqTable;
}