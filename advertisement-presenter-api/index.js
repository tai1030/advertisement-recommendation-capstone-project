const DynamoDB = require("aws-sdk/clients/dynamodb");

// Load DynamoDB client
const dynamodb = new DynamoDB.DocumentClient({
    region: 'us-east-2'
});

// Label min. confidence
var minConfidenceLabel = 60;

exports.handler = async (event, context, callback) => {
    /*
        Example request JSON format
        {
            "cid": "C-1000001",
            "platform": "web",
            "width": 272,
            "height": 92,
            "content": "Raw dog food diets are controversial. But the popularity of the diets -- which emphasize raw meat, bones, fruits, and vegetables -- is rising.  Racing greyhounds and sled dogs have long eaten raw food diets. Extending those feeding practices to the family pet is a more recent idea, proposed in 1993 by Australian veterinarian Ian Billinghurst. He called his feeding suggestions the BARF diet, an acronym that stands for Bones and Raw Food, or Biologically Appropriate Raw Food.  Billinghurst suggested that adult dogs would thrive on an evolutionary diet based on what canines ate before they became domesticated: Raw, meaty bones and vegetable scraps. Grain-based commercial pet foods, he contended, were harmful to a dog’s health.  Many mainstream veterinarians disagree, as does the FDA. The risks of raw diets have been documented in several studies published in veterinary journals."
        }
    */
    const requestBody = JSON.parse(event.body);
    console.log(requestBody);

    // Check request body format
    if (!validateRequestBody(requestBody)) {
        return sendResponse({
            "status": false,
            "message": "Invalid request"
        });
    }

    // Get keywords from input content
    var keywords = [];
    if (typeof requestBody.content !== 'undefined' && requestBody.content !== null && requestBody.content !== '') {
        keywords = parseContent(requestBody.content);
    }

    // Get ads by label
    var ads = [];
    if (keywords.length > 0) {
        // Get file+info filtered by label
        ads = await getAdsListByLabels(keywords);
    } else {
        // Get all file+info
        ads = await getAdsList();
    }
    


    // API response
    // return sendResponse({
    //     "status": true,
    //     "message": isUpdate ? "Updated 1 advertisement successfully" : "Added 1 advertisement successfully"
    // });

    function sendResponse(jsonObject) {
        callback(null, {
            isBase64Encoded: false,
            statusCode: 200,
            body: JSON.stringify(jsonObject),
            headers: {
                "Access-Control-Allow-Origin": trustedCorsReferrer(event.headers['Referer'] !== undefined ? event.headers['Referer'] : '')
            }
        });
        return;
    }
};

function validateRequestBody(requestBody) {
    if (typeof requestBody === 'undefined') {
        console.warn('API request validatation failed | Check: requestBody=undefined');
        return false;
    }

    // Check rules for base object
    const rules = [
        typeof requestBody.platform === 'string' && ['web', 'react-native'].includes(requestBody.platform),
    ];
    if (!rules.every(Boolean)) {
        console.warn('API request validatation failed | Check: ' + JSON.stringify(rules));
        return false;
    }

    return true;
}

function parseContent(content) {
    const ignoreList = [
        '', 'is', 'are', 'am', 'i', 'he', 'she', 'it', 'we', 'them', 'they', 'him', 'his', 'her', 'us', 'and', 'or', 'but', 'the', 'of', 'which', 'by', 'a', 'an', 'what', 'why', 'which', 'when', 'how', 'to', 'about', 'yes', 'no', 'not', 'yes', 'yet', 'have', 'has', 'had', 'be', 'been', 'as', 'too', 'many', 'much', 'before', 'after', 'by', 'more', 'less', 'the', 'that'
    ];
    var resultKeywords = [];
    const keywords = content.replace(/[^a-zA-Z ]/g, "").toLowerCase().split(' ');
    for (var i in keywords) {
        if (ignoreList.includes(keywords[i]) || resultKeywords.includes(keywords[i])) {
            continue;
        }
        resultKeywords.push(keywords[i]);
    }
    return resultKeywords;
}

async function getAdsList() {
    return await getAdsListByLabels([]);
}

async function getAdsListByLabels(keywords) {
    var fids = [];

    // Batch query "label" table if provided "keywords"
    if (Array.isArray(keywords) && keywords.length > 0) {
        var batchQueryActions = [];
        for (var i in keywords) {
            batchQueryActions.push(await dynamodb.query({
                TableName: 'label',
                IndexName: 'label-rate-index',
                KeyConditionExpression: '#label = :label AND #rate > :rate',
                ExpressionAttributeNames: {
                    '#label': 'label',
                    '#rate': 'rate'
                },
                ExpressionAttributeValues: {
                    ':label': keywords[i],
                    ':rate': minConfidenceLabel,
                }
            }).promise());
        }
        const batchQueryResults = await Promise.all(batchQueryActions);
        for (var i in batchQueryResults) {
            const result = batchQueryResults[i];
            const items = typeof result.Items !== 'undefined' && result.Items !== null ? result.Items : [];
            var results = {};
            for (var i in items) {
                if (items[i].fid in results) {
                    // If existing, just put if the rate is higher
                    if (items[i].rate > results[items[i].fid]) {
                        results[items[i].fid] = items[i].rate;
                    }
                } else {
                    results[items[i].fid] = items[i].rate;
                }
            }

            // Sort by rate DESC
            var sortable = [];
            for (var label in results) {
                sortable.push([label, results[label]]);
            }
            sortable.sort(function(a, b) {
                return b[1] - a[1];
            });
            for (var label in sortable) {
                fids.push(label);
            }
        }
    }

    // Get files
    var files = [];
    if (fids.length > 0) {
        // List file by "fid"
        var batchQueryActions = [];
        for (var i in fids) {
            batchQueryActions.push(await dynamodb.query({
                TableName: 'file',
                KeyConditionExpression: '#fid = :fid',
                ExpressionAttributeNames: {
                    '#fid': 'fid'
                },
                ExpressionAttributeValues: {
                    ':fid': fids[i]
                }
            }).promise());
        }
        const batchQueryResults = await Promise.all(batchQueryActions);
        for (var i in batchQueryResults) {
            const result = batchQueryResults[i];
            const items = typeof result.Items !== 'undefined' && result.Items !== null ? result.Items : [];
            /**
             * Object: fid, aid, type, url, content, width, height
             */
            if (items.length > 0) {
                files.push(items[0]);
            }
        }
    } else {
        // List file
        const result = await dynamodb.scan({
            TableName: 'file'
        }).promise();
        files = result.Items !== undefined ? result.Items : [];
    }

    // Get aids by files
    const aids = []; // [TODO]

    // Get info, merge into "files"
    // [TODO]

    return []; // [TODO]
}

function trustedCorsReferrer(referrer) {
    if (referrer.startsWith('http://localhost/')) {
        return 'http://localhost';
    }
}