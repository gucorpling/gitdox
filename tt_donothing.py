#!/usr/bin/python2
# -*- coding: utf-8 -*-

import cgi, os, sys, subprocess, tempfile, re

def exec_via_temp(input_text, command_params, workdir=""):
	temp = tempfile.NamedTemporaryFile(delete=False)
	exec_out = ""
	try:
		temp.write(input_text)
		temp.close()

		command_params = [x if x != 'tempfilename' else temp.name for x in command_params]
		if workdir == "":
			proc = subprocess.Popen(command_params, stdout=subprocess.PIPE,stdin=subprocess.PIPE,stderr=subprocess.PIPE)
			(stdout, stderr) = proc.communicate()
		else:
			proc = subprocess.Popen(command_params, stdout=subprocess.PIPE,stdin=subprocess.PIPE,stderr=subprocess.PIPE,cwd=workdir)
			(stdout, stderr) = proc.communicate()

		exec_out = stdout
	except Exception as e:
		print(e)
	finally:
		os.remove(temp.name)
		return exec_out


storage = cgi.FieldStorage()
if "data" in storage:
	data = storage.getvalue("data")
else:
	data = ""


tt_path = '/var/www/html/coptic-nlp/script/treetagger/'

tokenize = ['perl', tt_path + 'cmd/tokenize.pl', '-e','-a',tt_path+'lib/english-abbreviations','tempfilename']
#data = exec_via_temp(data, tokenize)
data = re.sub(r'\n+',r'\n',data)

print("Content-Type: text/plain; charset=UTF-8\n")
print(data)

