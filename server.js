var express = require('express');
var app = express();
// var open = require('open');
var serverPort = (4443);
var http = require('http');
var server = http.createServer(app);
var io = require('socket.io')(server);

// var mongo = require('mongodb');
var monk = require('monk');
var db = monk('localhost:27017/intercom');
var userCollection = db.get('userCollection');

var glob = require("glob");
var path = require('path');
var fs = require("fs");
var moment = require('moment');

var sockets = {};
var users = {};

var appDir = path.dirname(require.main.filename);
console.log(appDir);

function sendTo(connection, message) {
   connection.send(message);
}

app.get('/', function(req, res){
  console.log('get /');
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', function(socket){
  console.log("user connected");

  socket.on('disconnect', function () {
    console.log("user disconnected");
    if(socket.room){
      socket.broadcast.to(socket.company).emit('roommessage',{ type: "disconnect", room: socket.room})
      socket.leave(socket.company);
      delete sockets[socket.company][socket.room];
      delete users[socket.company][socket.room];
      if(sockets[socket.company] == {}){
        console.log("empty company!");
        delete sockets[data.company];
        delete users[data.company];
      }
    }
  })

  socket.on('message', function(message){

    var data = message;

    switch (data.type) {

      case "login":
      //if anyone is logged in with this room name then refuse
      if(sockets[data.company] && sockets[data.company][data.room]) {
         sendTo(socket, {
            type: "login",
            success: false
         });
      } else {
        //update database
        console.log("User logged in", data.company + " - " + data.room);
        console.log("deviceID: " + data.deviceID);
        userCollection.find({'deviceID' : data.deviceID},function(err,docs){
          if (err === null){
            console.log(docs);
            if (docs.length == 0){
              // if this a first time login using this device
              console.log("create new user");
              var user = {
                "deviceID": data.deviceID,
                "room": data.room,
                "company" : data.company
              };
              userCollection.insert(user);

              //print new user inserted
              userCollection.find({'deviceID' : data.deviceID},function(err,docs){
                if (err === null){
                  console.log(docs);
                }
                else{
                  console.log("error: " + err);
                }
              });
            }
            else{
              // change user of device
              userCollection.findOneAndUpdate(
                {"deviceID": data.deviceID},
                {$set: {"room": data.room,
                        "company" : data.company} },
                {returnNewDocument: true},
                function(err,doc) {
                  if (err === null){
                    console.log("updated: ");
                    console.log(doc);
                  }
                  else{
                    console.log("error: " + err);
                  }
                }
              )
            }
          }
          else{
            console.log("error: " + err);
          }
        });

        //save user connection on the server
        var templist = users[data.company];

        if(!sockets[data.company]){
          console.log("here1");
          sockets[data.company]={};
          console.log(sockets[data.company]);
        }

        console.log(sockets);
        sockets[data.company][data.room] = socket;
        socket.company = data.company;
        socket.room = data.room;

        //send voicemail to this logined user
        glob( "voicemails/" + data.company + "/" + data.room + "/*/*.opus", function (er, files) {
          if(er === null){
            getVoiceMails(files).then(voicemails => {
              console.log("send!");
              sendTo(socket, {
                type: "login",
                success: true,
                room: data.room,
                userlist: templist,
                voicemails: voicemails,
              });

              socket.broadcast.to(data.company).emit('roommessage',{ type: "login", room: data.room, socketId: socket.id})
              socket.join(data.company);
              if(!users[data.company]){
                users[data.company] = {};
              }
              users[data.company][data.room] = socket.id
            });
          }
          else{
              console.log("error: " + er);
          }
        });
      }

      break;
      case "logout":
      console.log("User logged out", data.company + " - " + data.room);
      console.log("deviceID: " + data.deviceID);      
      if(socket.room){
        delete sockets[data.company][data.room];
        delete users[data.company][data.room];
        console.log("sockets[data.company]:")
        console.log(sockets[data.company])
        if(Object.keys(sockets[data.company]).length === 0 && sockets[data.company].constructor === Object){
          console.log("empty company!");
          delete sockets[data.company];
          delete users[data.company];
        }
        socket.broadcast.to(data.company).emit('roommessage',{ type: "logout", room: socket.room})
        socket.leave(data.company);
        sendTo(socket, {
          type: "logout",
          success: true,
        });
      }
      break;
      case "call_user":
      // chek if user exist
        if(sockets[data.company][data.room]){
          console.log("user called");
          console.log(data.company + " - " + data.room);
          console.log(data.company + " - " + data.callername);
        sendTo(sockets[data.company][data.room], {
           type: "call_request",
           callername: data.callername
        });
      }else{
        sendTo(socket, {
           type: "call_response",
           response: "offline"
        });
      }
      break;
      case "call_accepted":
      sendTo(sockets[data.company][data.callername], {
         type: "call_response",
         response: "accepted",
         responsefrom : data.from

      });
      break;
      case "call_rejected":
      sendTo(sockets[data.company][data.callername], {
         type: "call_response",
         response: "rejected",
         responsefrom : data.from
      });
      break;
      case "call_busy":
      sendTo(sockets[data.company][data.callername], {
         type: "call_response",
         response: "busy",
         responsefrom : data.from
      });
      case "voice_mail":
      writeToDisk(data.audio.dataURL, data.company, data.to, data.from, moment().format("YYYY-MM-DD-HH-mm-ss") + '.opus');
      default:
      sendTo(socket, {
         type: "error",
         message: "Command not found: " + data.type
      });
      break;
    }

  });

  socket.on('exchange', function(data){
    console.log('exchange', data);
    data.from = socket.id;
    var to = io.sockets.connected[data.to];
    to.emit('exchange', data);
  });
});

function getVoiceMails(paths){
  var voicemails = {}
  console.log("paths: " + paths);
  for (var i = 0; i<paths.length; i++){
    var voicemails_company_to_from_fileName = paths[i].split('/');
    var company = voicemails_company_to_from_fileName[1];
    var to = voicemails_company_to_from_fileName[2];
    var from = voicemails_company_to_from_fileName[3];
    var fileName = voicemails_company_to_from_fileName[4];
    
    console.log("company: " + company);
    console.log("to: " + to);
    console.log("from: " + from);
    console.log("fileName: " + fileName);

    var file = fs.readFileSync(paths[i], 'base64');
    voicemails[paths[i]] = file;
    console.log("voicemails: "+ voicemails);
    // console.log(file);
  }
  console.log(voicemails);
  return Promise.resolve(voicemails);
}

function ensureDirectoryExistence(filePath) {
  var dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
}

function writeToDisk(dataURL, company, to, from, fileName) {
  var fileExtension = fileName.split('.').pop(),
      fileRootNameWithBase = './voicemails/' + company + '/' + to + '/' + from + '/' + fileName,
      filePath = fileRootNameWithBase,
      fileID = 2,
      fileBuffer;

  // @todo return the new filename to client
  while (fs.existsSync(filePath)) {
      filePath = fileRootNameWithBase + '(' + fileID + ').' + fileExtension;
      fileID += 1;
  }

  dataURL = dataURL.split(',').pop();
  fileBuffer = new Buffer(dataURL, 'base64');

  ensureDirectoryExistence(filePath);
  fs.writeFileSync(filePath, fileBuffer);
}

server.listen(serverPort, function(){
  console.log('server up and running at %s port', serverPort);
});