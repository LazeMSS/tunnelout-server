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
		if (e.target.dataset.ajaxsrc != undefined){
			ajaxGet(e.target.dataset.ajaxsrc);
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
	}

	document.addEventListener('click', handleEvent);

	// CLick first item
	var lastPath = document.location.pathname.split("/").slice(-2,-1);
	if (lastPath == "dashboard"){
		document.getElementById("menulist").getElementsByClassName('pure-menu-link')[0].click();
	}else{
		buildHostsMenu([lastPath]);
	}

}(this, this.document));

function ajaxGet(loadThis){
	var xhr = new XMLHttpRequest();
	xhr.open('GET', loadThis);
	xhr.onload = function() {
		if (xhr.status === 200) {
			var json = JSON.parse(xhr.responseText);
			document.getElementById('maincontent').innerHTML = scan(json);
		}else {
			alert('Request failed.  Returned status of ' + xhr.status);
		}
	};
	xhr.send();
}

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
	hosts.forEach(function(currentValue , index){
		menulist.insertAdjacentHTML('beforeend', '<li class="pure-menu-item host-name-link"><a href="#" class="pure-menu-link" data-ajaxsrc="/api/tunnels/'+currentValue+'/status" data-header="'+currentValue+'" data-subheader="Tunnel status">'+currentValue+'</a></li>');
	});

}