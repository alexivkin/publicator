'use strict'

$(function () {
  // for handlebar troubleshooting
  Handlebars.registerHelper("debug", function (optionalValue) {
    console.log("Current Context");
    console.log(this);
    if (optionalValue) {
      console.log("Value");
      console.log(optionalValue);
    }
  });
  // datetime handling
  const dtp=$('#dtpicker').datetimepicker({
    footer: true,
    modal: false,
    uiLibrary: 'bootstrap4',
    datepicker: {
      disableDates: (date) => {
        return date >= new Date().setHours(0,0,0,0) ? true : false
      }
    }
  });
  const timeFormat = new Intl.DateTimeFormat('en',{ hour: '2-digit', minute: '2-digit', hour12: false})
  const dateFormat = new Intl.DateTimeFormat('en',{ month: '2-digit', day: '2-digit', year: 'numeric'})
  // make timestamps human readable
  function timeUpdate() {
    $("#lastgenerated").text($('#lastgenerated_timestamp').val() ? moment($('#lastgenerated_timestamp').val()).fromNow() : "never")
    $("#lastpublished").text($('#lastpublished_timestamp').val() ? moment($('#lastpublished_timestamp').val()).fromNow() : "never")
    // prefill scheduled time if provided
    if ($('#scheduled_timestamp').val()){
      let sd=new Date($('#scheduled_timestamp').val())
      dtp.value(timeFormat.format(sd)+" "+dateFormat.format(sd))
      $("#scheduledtime").text("Scheduled "+moment(sd).fromNow())
    } else {
      $("#scheduledtime").text("Not scheduled")
    }
  }
  // update now and in the loop to redraw the lapsed time every minute
  timeUpdate()
  setInterval(timeUpdate, 60000)
  
  const scdiv = document.getElementById('scrapereditor'); // scraping editor setup
  const fbdiv = document.getElementById('firebaseeditor'); // hosting editor setup
  // Setup options during instantiation
  let scedit, fbedit;
  $.get(location.protocol + '//' + location.host + '/config/scraper').done(fbconfig => {
  $.get(location.protocol + '//' + location.host + '/config/scraper/schema').done(fbschema => {
  const editor_config = {
    startval: fbconfig,
    schema: fbschema,
    disable_array_delete_all_rows: true,
    disable_array_delete_last_row: true,
    disable_array_reorder: true,
    disable_edit_json: true,
    disable_properties: true,
    no_additional_properties: true,
    remove_button_labels: true,
    iconlib: 'fontawesome5',
    theme: 'bootstrap4'
  }
  
  scedit = new JSONEditor(scdiv, editor_config)
}).fail(() => {
  scdiv.textContent = "Failed to load scraper schema"
})
}).fail(() => {
  scdiv.textContent = "Failed to load scraper config"
})

$.get(location.protocol + '//' + location.host + '/config/firebase').done(fbconfig => {
$.get(location.protocol + '//' + location.host + '/config/firebase/schema').done(fbschema => {
const editor_config = {
  startval: fbconfig,
  schema: fbschema,
  disable_array_delete_all_rows: true,
  disable_array_delete_last_row: true,
  disable_array_reorder: true,
  disable_edit_json: true,
  disable_properties: true,
  no_additional_properties: true,
  remove_button_labels: true,
  iconlib: 'fontawesome5',
  theme: 'bootstrap4'
}
fbedit = new JSONEditor(fbdiv, editor_config)
}).fail(() => {
  fbdiv.textContent = "Failed to load firebase schema"
})
}).fail(() => {
  fbdiv.textContent = "Failed to load firebase config"
})

// enable all tooltips
$('[data-toggle="tooltip"]').tooltip()
// button click handling
// generate button
$('#generate').click(event => {
  $("#fbedit_collapse").collapse('hide') // just a nice thing to do for the user
  var eventSourceUrl = document.URL + '/generate'
  var source = new EventSource(eventSourceUrl);
  $('#generate').prop("disabled", true)
  $('#lastgenerated').text("in process")
  source.addEventListener('stdout', function (e) {
    var data = JSON.parse(e.data)
    if (e.data == '"zeend"') {
      e.target.close() // identical to source.close()
      $('#generate').prop("disabled", false)
      $('#lastgenerated_timestamp').val(new Date().toISOString())
      $('#lastgenerated').text(moment(new Date().toISOString()).fromNow())
    } else {
      $('#ta-stdout').append(data);
    }
  }, false);
  source.addEventListener('stderr', function (e) {
    var data = JSON.parse(e.data)
    if (e.data == '"zeend"') {
      e.target.close()
    } else {
      $('#ta-stdout').append("Error:" + data);
    }
  }, false);
})
// save config
$('#scrapersave').click(event => {
  $.post(location.protocol + '//' + location.host+ '/config/scraper/save', {sc: scedit.getValue()},(d) => {
  $("#scrapersavestatus").text('Saved')
}).fail((e)=> {
  $("#scrapersavestatus").text(e.responseText?e.responseText:"Error")
})
});

$('#firebasesave').click(event => {
  $.post(location.protocol + '//' + location.host+ '/config/firebase/save', {fb: fbedit.getValue()},(d) => {
  $("#firebasesavestatus").text('Saved')
}).fail((e)=> {
  $("#firebasesavestatus").text(e.responseText?e.responseText:"Error")
})
});

// open preview in a new tab
$('#preview').click(event => {
  $("#fbedit_collapse").collapse('hide') // just a nice thing to do for the user
  window.open($('#preview_link').val(), '_blank');
})
// publish
$('#publishnow').click(event => {
  var eventSourceUrl = document.URL + '/publish'
  var source = new EventSource(eventSourceUrl);
  
  source.addEventListener('stdout', function (e) {
    var data = JSON.parse(e.data)
    $('#publishnow').prop("disabled", true)
    $('#lastpublished').text("in process")
    if (e.data == '"zeend"') {
      e.target.close() // identical to source.close()
      $('#publishnow').prop("disabled", false)
      $('#lastpublished_timestamp').val(new Date().toISOString())
      $('#lastpublished').text(moment(new Date().toISOString()).fromNow())
    } else {
      $('#ta-stdout').append(data);
    }
  }, false);
  source.addEventListener('stderr', function (e) {
    var data = JSON.parse(e.data)
    if (e.data == '"zeend"') {
      e.target.close() // identical to source.close()
    } else {
      $('#ta-stdout').append("Error:" + data);
    }
  }, false);
})
// handle click on the schedule button
$('#schedule').click(event => {
  let scheduled = new Date($('#dtpicker').val())
  $.post(document.URL + '/schedule', {ts: scheduled},(d) => {
    $('#scheduled_timestamp').val(scheduled.toISOString())
    $("#scheduledtime").text("Scheduled " + moment(scheduled).fromNow())
  }).fail((e)=> {
    $("#scheduledtime").text(e.responseText?e.responseText:"Error")
  })
})
// cancel schedule click
$('#cancelschedule').click(event => {
  $.post(document.URL + '/schedule', {},(d) => {
    $("#scheduledtime").text("Not scheduled")
  })
})


})