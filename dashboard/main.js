/**

 todo:
	UI
		admin:
			user editor/display
			block/delete client in client list

 **/

var templates = {
	'os' :
		{
			'title'	: 'Operation system (OS)',
			'icon' 	: 'bi bi-cpu'
		},

	'configuration' :
		{
			'title'	: 'Configuration',
			'icon' 	: 'bi bi-sliders'
		},

	'enviroment':
		{
			'title'	: 'Enviroment',
			'icon' 	: 'bi bi-terminal'
		},

	'clients': {
			'title'	: 'Clients',
			'icon' 	: 'bi bi-people'
		},
	'basic': {
			'title'	: 'Basic',
			'icon' 	: 'bi bi-info-lg'
		},
	'stats': {
			'title'	: 'Statistics',
			'icon' 	: 'bi bi-activity'
		},

};

// Hackish
var noCpus = 0;
var headerModal = null;
var confirmModal = null;
var clientTimer = null;
var adminTimer = null;
var isAdmin = false;


// Main load
$(function () {
	window.addEventListener('popstate', function(e) {
		if (e.state == null || e.state == '/dashboard/'){
			loadAdmin(false);
			return;
		}
		// What type of request
		var cleanUrl = e.state.replace(/\/$/, '');
		var lastPath = cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1);
		loadClient(lastPath,false);
	})

	// What type of request
	var cleanUrl = window.location.pathname.replace(/\/$/, '');
	var lastPath = cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1);
	var cookie = getCookie('authType');

	// Create modal
	headerModal  = new bootstrap.Modal(document.getElementById('headerinspect'));
	confirmModal = new bootstrap.Modal(document.getElementById('confirmDialog'));

	if (cookie == "user"){
		$('a.navbar-brand').on('click',function(event){
			event.stopImmediatePropagation();
			event.preventDefault();
			loadClient(lastPath,false);
			return false;
		});
	}else{
		isAdmin = true;
		$('a.navbar-brand').on('click',function(event){
			event.stopImmediatePropagation();
			event.preventDefault();
			loadAdmin(true);
			return false;
		});
	}

	// Security is handle by backend - this is just for easy display
	if (cookie == "user" || lastPath != "dashboard"){
		loadClient(lastPath,false);
	}else{
		loadAdmin(false);
	}
});

function fetchData(url,callbackf){
	$('#mainSpinner').remove();
	$('#fetchSpinner').removeClass('d-none');

	fetch(url)
	.then(async response => {
		const isJson = response.headers.get('content-type')?.includes('application/json');
		const data = isJson ? await response.json() : null;
		$('#fetchSpinner').addClass('d-none');
		if (!response.ok) {
			var error = (data && data.message) || response.status;
			error += " " + response.statusText;
			return Promise.reject(error);
		}
		if (typeof callbackf == "function"){
			callbackf(data);
		}
	})
	.catch(error => {
		$('#fetchSpinner').addClass('d-none');
		ajaxError("Failed to fetch data on: "+url,error);
	});
}

function apiGeneric(url,setmethod,callbackf){
	$('#mainSpinner').remove();
	$('#fetchSpinner').removeClass('d-none');

	fetch(url, {
    	method: setmethod
  	})
  	.then(async response => {
		const isJson = response.headers.get('content-type')?.includes('application/json');
		const data = isJson ? await response.json() : await response.text();

		$('#fetchSpinner').addClass('d-none');
		if (!response.ok) {
			var error = (data && data.message) || response.status;
			error += " " + response.statusText;
			return Promise.reject(error);
		}
		if (typeof callbackf == "function"){
			callbackf(data,response.ok);
		}
	})
	.catch(error => {
		$('#fetchSpinner').addClass('d-none');
		ajaxError("Failed to call the API on: "+url,error+"\nMethod:"+setmethod);
	});
}

function ajaxError(message,tech){
	$('.ajax-alert').remove();
	var alertMSG = $('<div class="ajax-alert alert alert-primary alert-dismissible" role="alert"><h4 class="alert-heading"><i class="me-1 bi bi-bug"></i>Ajax/Backend error</h4><p>'+message+'</p><hr/><pre class="mb-0">Data:\n'+tech+'</pre><button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button></div>');
	$('#mainContainer').prepend(alertMSG);
}

function loadClient(lastPath,pop){
	$('#clientdashboard').empty();
	if (adminTimer != null){
		window.clearInterval(adminTimer);
		adminTimer = null;
	}

	// Get data and pop if successfull
	fetchData('/api/tunnels/'+lastPath,function(data){
		if (pop){
			history.pushState('/dashboard/c/'+lastPath,null,'/dashboard/c/'+lastPath+"/");
		}
		buildUserDash(data);
	});

	// server status automatic refresh
	if (clientTimer == null){
		clientTimer = setInterval(function(){
			fetchData('/api/tunnels/'+lastPath,buildUserDash);
		}, 30000);
	}
}

function loadAdmin(pop){
	if (clientTimer != null){
		window.clearInterval(clientTimer);
		clientTimer = null;
	}

	// Get data and pop if successfull
	fetchData('/api/status',function(data){
		if (pop){
			history.pushState('/dashboard/',null,'/dashboard/');
		}
		buildAdminDash(data);
	});

	// server status automatic refresh
	if (adminTimer == null){
		adminTimer = setInterval(function(){
			fetchData('/api/status',buildAdminDash);
		}, 30000);
	}
}

// Quick format system vars
function sysToUsrTxt(str){
	str = str.replaceAll("_"," ");
	str = str.charAt(0).toUpperCase() + str.slice(1);
	if (typeof str == "number"){
		return "";
	}
	return str;
}

function formatData(str){
	if(typeof str == "number"){
		return str.toLocaleString();
	}
	return str;
}

function calcMemUsage(obj){
	var total = obj['total_mem'].replace(" MB","");
	var free = obj['free_mem'].replace(" MB","");
	return Math.round(((total-free)/total)*100);
}

// Wrapper for the worst ui pretty mockery
function specialData(obj,k,parent = null){
	if (parent == "os"){
		if (k == "total_mem"){
			var prc = calcMemUsage(obj);
			return '</li><li class="list-group-item"><div class="progress noRemove" style="height: 20px;"><div id="memgraph" class="progress-bar noRemove" role="progressbar" style="width: '+prc+'%;">'+prc+'%</div></div></li>';
		}
		if (k == "cpus"){
			noCpus = obj[k];
		}
	}
	if (parent == "load_avg"){
		var prc = Math.round((obj[k]/noCpus)*100);
		return '<div class="w-100 progress noRemove position-absolute bottom-0 start-50 translate-middle-x" style="height: 2px;"><div class="progress-bar noRemove" role="progressbar" style="width: '+prc+'%;"></div></div>';
	}

	return "";
}

function updateTime(){
	$('#lastudpated').text(new Date().toLocaleString());
}

// Build main UI/Cards
function buildDashCards(data,target){
	var noclients = 0;
	$.each(data,function(key,dataSet){
		var templateSet = {'title' : sysToUsrTxt(key), 'icon' : 'removeMe'};
		if (key in templates){
			templateSet = templates[key];
		}

		// Updated or new
		if ($('#dashcard_'+key).length){

			// Last 10 requests is special
			if (target == "clientdashboard" && key == "stats"){
				$('#requestTable').remove();
				if (dataSet.last10request.length > 0){
					reqTable = buildRequestTable(dataSet);
					$('#dashcard_stats div.card-body').append(reqTable);
				}
				delete dataSet.last10request;
			}

			// Update clients
			if (target == "serverdashboard" && key == "clients"){
				$('#clientList').replaceWith(buildAdminClientList(dataSet));
				noclients = Object.keys(dataSet).length;
			}else{
				updateUiItem(key,dataSet);
			}

			// Remove any non updated items
			$('#dashcard_'+key+' span.udatedata:not(.updated)').parent().remove();

		}else{
			// Add
			var clon = $($("#cardtemplate").clone().contents());
			clon.find('.cardmainicon').addClass(templateSet.icon);
			clon.find('.card-title').text(templateSet.title);

			var listGroup = clon.find('.list-group');
			// Last 10 requests is special
			if (target == "clientdashboard" && key == "stats"){
				if (dataSet.last10request.length > 0){
					reqTable = buildRequestTable(dataSet);
					listGroup.after(reqTable);
				}
				delete dataSet.last10request;
			}

			// Special for clients
			if (target == "serverdashboard" && key == "clients"){
				noclients = Object.keys(dataSet).length;
				clon.find('.card-title').after('<h1 class="display-1 text-center" id="noclients">'+noclients+'</h1>');
				clon.find('ul.list-group').replaceWith(buildAdminClientList(dataSet));
			}else{
				// Standard data
				listGroup.append(buildUlItems(dataSet,0,key));
			}

			// Remove all empty
			clon.find('.removeMe').remove();
			clon.find(':empty:not(i,.noRemove)').remove();
			clon.prop('id','dashcard_'+key);
			$('#'+target).append(clon);
		}
	});

	// show search
	if (noclients == 0){
		noclients += '<i class="position-absolute top-50 start-50 translate-middle w-100 d-block text-primar bi bi-emoji-neutral text-secondary text-opacity-25 hourglass" style="font-size:200%"></i>';
	}
	$('#noclients').html(noclients);
	if ($('#clientList table tbody tr').length > 10){
		if (!$('#clientFilter').length){
			$('#clientList').before($('<input id="clientFilter" type="search" class="mb-2 form-control" placeholder="Filter clients">').on('search keyup',function(event){
				var keyword = $(this).val();
				filterClients(keyword);
			}));
		}
		filterClients($('#clientFilter').val());
	}else{
		$('#clientFilter').hide();
		$('#clientList table tbody tr').show();
	}

	$('#'+target+' span.udatedata.updated').removeClass('updated');
	// Remove dead parents
	$('#'+target+' div.servercard .list-group-item.haschildren:last-child').remove();
	updateTime();
}

function filterClients(keyword){
	if (keyword == ""){
		$('#clientList table tbody tr').show();
		return;
	}
	$('#clientList table tbody tr').each(function(){
		if ($(this).text().indexOf(keyword) != -1){
			$(this).show();
		}else{
			$(this).hide();
		}
	});
}

function buildAdminClientList(dataSet){
	var domHolder = $('<div id="clientList" class="h-100 table-responsive border-bottom border-top"><table class="border-bottom-0 mb-0 caption-top text-nowrap table table-sm table-hover"><thead><tr><th>Name</th><th>IP</th><th class="text-end">Disconnect</th></tr></thead><tbody class="align-middle"></tbody></table></div>');
	var tbody = domHolder.find('tbody');

	var rowCounter = 0;
	$.each(dataSet,function(hostname,data){
		var trow = $('<tr>');
		var link = $('<td><a href="#">'+hostname+'</a></td>').on('click',function(event){
			loadClient(hostname,true);
			event.stopImmediatePropagation();
			event.preventDefault();
			return false;
		})
		trow.append(link);

		link = $('<td><a href="https://www.whois.com/whois/'+data.ip_adr+'" target="_blank">'+data.ip_adr+'<i class="ps-1 bi bi-box-arrow-up-right"></i></a></td>');
		trow.append(link);

		var discli = $('<td class="text-end pe-2"><button type="button" title="Disconnect client" class="btn btn-sm btn-outline-primary"><i class="bi bi-door-closed"></i></button></td>');
		discli.find('button').on('click',function(event){
			showConfirm('<i class="bi bi-door-closed me-1"></i>Confirm disconnect client&hellip;','Are you sure you want to disconnect "'+hostname+'"?',function(result){
				if (result){
					apiGeneric('/api/tunnels/'+hostname,'DELETE',function(data){
						loadAdmin(false);
					});
				}
			});
			event.stopImmediatePropagation();
			event.preventDefault();
			return false;
		})
		trow.append(discli);
		tbody.append(trow);
		rowCounter++;
	})
	if (rowCounter == 0){
		return $('<div id="clientList" class="table-responsive">&nbsp;</div>');
	}
	return domHolder;
}

function showConfirm(header,body,callbackf){
	$('#confirmDialog .modal-title').html(header);
	$('#confirmDialog .modal-body').html(body);
	$('#confirmDialog').data('returnVal',false);
	// Native listner - cash.js does not work with bootstap custom events
	$('#confirmDialogYes').one('click',function(){
		$('#confirmDialog').data('returnVal',true);
		confirmModal.hide();
	})
	document.getElementById('confirmDialog').addEventListener('hidden.bs.modal', function modalListner(event) {
  		document.getElementById('confirmDialog').removeEventListener('hidden.bs.modal', modalListner);
  		callbackf($('#confirmDialog').data('returnVal'));
	})
	confirmModal.show();
}

function buildRequestTable(dataSet){
	var th = '<thead><tr>';
	Object.keys(dataSet.last10request[0]).map(function(key, index) {
		th += '<th>'+sysToUsrTxt(key)+'</th>';
	});
	th += '</tr></thead>';
	var reqTable = $('<div class="table-responsive" id="requestTable"><table class="mb-0 caption-top text-nowrap table table-sm table-hover"><caption>Last 10 requests seen</caption>'+th+'<tbody class="align-middle"></tbody></table></div>');
	var tbody = reqTable.find('tbody');
	$.each(dataSet.last10request,function(x,reqdat){
		var tr = $('<tr>');
		$.each(reqdat,function (key,celldat){
			// Show headers
			if (key == "headers"){
				var headlink = $('<a href="#" class="btn btn-sm btn-outline-primary"><i class="bi bi-card-heading"></i></a>');
				$(headlink).on('click',function(event){
					var dlHtml = '<dl class="row">';
					// Append main data
					$.each(reqdat,function (keydl,datdl){
						if (keydl != "headers"){
							dlHtml += '<dt class="col-sm-3">'+sysToUsrTxt(keydl)+'</dt><dd class="col-sm-9 techdata">'+datdl+'</dd></dt>';
						}
					});
					dlHtml += '</dl><hr><dl class="mb-0 row">';
					// Headers
					$.each(celldat,function (keydl,datdl){
						dlHtml += '<dt class="col-sm-3">'+keydl+'</dt><dd class="col-sm-9 techdata">'+datdl+'</dd></dt>';
					});
					dlHtml += '</dl>';
					$('#headerinspect div.modal-body').html(dlHtml);

					headerModal.show();
					event.stopImmediatePropagation();
					event.preventDefault();
					return false;
				});
				tr.append($('<td>').append(headlink));
				return true;
			}

			// Format timestamp
			if (key == "reqTime"){
				celldat = new Date(celldat).toLocaleString();
			}
			if (key == "ip"){
				celldat = '<a href="https://whois.domaintools.com/'+celldat+'" target="_blank">'+celldat+'<i class="ps-1 bi bi-box-arrow-up-right"></i></a>';
			}
			tr.append('<td class="techdata">'+celldat+'</td>');
		});
		tbody.append(tr);
	});
	return reqTable;
}

// Update just values not entire UI
function updateUiItem(parent,data){
	$.each(data,function(key,dataSet){
		if (typeof dataSet == "object"){
			updateUiItem(key,dataSet);
		}else{
			var item = $('#datavalue_'+parent+"_"+key);
			if (!item.length){
				// Todo add item?
				console.log(key + " not found in dash");
				return false;
			}
			item.addClass('updated');
			if (parent == "load_avg"){
				var prc = Math.round((dataSet/noCpus)*100);
				item.next().find('div.progress-bar').css('width',prc+"%");
				return true;
			}
			if (key == "total_mem"){
				var prc = calcMemUsage(data);
				$('#memgraph').css('width',prc+"%").text(prc+"%");
				return true;
			}
			item.html(formatData(dataSet))
		}
	});
}

function buildUlItems(obj,level = 0,parent=null){
	var k;
	var strReturn = '';
	if (obj instanceof Object) {
		for (k in obj){
			var hasChildren = '';
			if (obj.hasOwnProperty(k) && obj[k].length !== 0 && typeof obj[k] == "object"){
				hasChildren = ' haschildren';
			}
			strReturn += '<li class="list-group-item d-flex justify-content-between align-items-start ps-'+level+' datalist-'+level+''+hasChildren+'">';
			if (!Array.isArray(obj)){
				strReturn += sysToUsrTxt(k);
			}else{
				if (parent == "load_avg"){
					var items = ['1 min.','5 min.','15 min.'];
					strReturn += items[k];
				}else{
					strReturn += "&nbsp;";
				}
			}
			// find children
			if (hasChildren != ""){
				strReturn += buildUlItems(obj[k],level+3,k);
			}else{
				strReturn += '<span class="udatedata" id="datavalue_'+parent+'_'+k+'">'+formatData(obj[k])+'</span>';
				strReturn += specialData(obj,k,parent);
			}
			strReturn += "</li>";
		}
	}
	return strReturn;
}

function buildUserDash(data){
	$('#serverdashboard').addClass('d-none');
	$('#mainheader').text(data.basic.id);
	buildDashCards(data,'clientdashboard');
	updateTime();
	$('#clientdashboard').removeClass('d-none');
	if (isAdmin){
		$('#backBtn').removeClass('d-none');
	}
}

function buildAdminDash(data){
	$('#backBtn').addClass('d-none');
	$('#clientdashboard').addClass('d-none');
	$('#mainheader').html('<i class="bi bi-shield-check me-1"></i>admin');
	buildDashCards(data,'serverdashboard');
	updateTime();
	$('#serverdashboard').removeClass('d-none');
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
