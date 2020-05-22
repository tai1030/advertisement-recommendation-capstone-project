$(document).ready(function () {

    /**
     * Get params from URL query string
     *  - cid [required] | Client ID in advertisement portal
     *  - platform [required] | Accept values: web | react-native
     *  - width [optional] | Width of advertisement presenter
     *  - height [optional] | Height of advertisement presenter
     *  - content [optional] | Input current page content for search the more related advertisements
     */
    const queryString = getAllParameters();

    // Call API to get the advertisement data
    $.ajax({
        type: 'POST',
        url: 'https://1abw3c097g.execute-api.us-east-2.amazonaws.com/presenter',
        data: queryString,
        dataType: 'json',
        success: function (advertisements) {
            /**
             * Return list of advertisements
             *  - title | Title of advertisement
             *  - link | Landing URL of advertisement
             *  - type | Display type of advertisement | Possible values: image | html
             *  - url | (For type="image") Image URL
             *  - content | (For type="html") HTML code
             *  - width | Width of advertisement
             *  - height | Height of advertisement
             */
            $('#canvas').html(JSON.stringify(advertisements, null, 2)); // debug
        },
      });
});

function getAllParameters() {
    var vars = [], hash;
    var hashes = window.location.href.slice(window.location.href.indexOf('?') + 1).split('&');
    for (var i = 0; i < hashes.length; i++) {
        hash = hashes[i].split('=');
        vars.push(hash[0]);
        vars[hash[0]] = hash[1];
    }
    return vars;
}