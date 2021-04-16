---
title: Gatsby, Lumen and Dark Mode
date: "2021-04-15T23:04:37.121Z"
template: "post"
draft: false
slug: "gatsby-lumen-and-dark-mode"
category: "Gatsby"
tags:
  - "Gatsby"
  - "React"
  - "Javascript"
description: "How I implemented dark mode in a Gatsby Lumen using CSS variables"
socialImage: "/media/image.jpg"
---

# Python-based static webpage

Previously, my web presence was composed of a static page built using staticjinja, an HTML5 UP template, and 
my own json parsing logic to build the different elements displayed. Back when I made it I had little experience with 
Javascript and no wish or need to update it continually as one does with a blog.[^1] It looked something like this:

<figure class="float-center">
	<img src="/media/old_website.png" alt="Old website look">
	<figcaption>Old website look.</figcaption>
</figure>

It worked well as I didn't have the need to update it often, but perhaps leading to it being usually very out-of-date as
I changed projects and workplaces.
Adding to this, the advent — or should I say return? — of blogging and developer diaries made me want to start my own 
blog.
This would be where I share what I learn along the way, some tricks and tips on Python and development strategies 
that seem to work for me. 

# Javascript static site generators
While Medium seems to be the platform of choice for these kinds of blogging, I'm a proponent of free open 
source software and of learning-by-doing, so this was a good opportunity to learn some more Javascript, React and 
Gatsby, an open source static site generator with good Markdown support.

## Making it mine
I have always had an obsessive relationship with tinkering and making my digital experiences as close to my liking as
possible. A good example is [Dark Reader](https://darkreader.org/), an open source browser extension that _"inverts brightness 
of web pages and aims to reduce eyestrain while you browse the web"_, which I currently use to handle pages that don't 
offer a native dark mode.

This website is based on [Lumen](https://github.com/alxshelepenok/gatsby-starter-lumen), a Gatsby starter blog with a 
minimalistic and pleasing design. Out of the box, it does not support a dark mode, making its implementation an 
interesting learning experience.

After some research — figuring out the quality of developer blog posts has become a skill in itself — I had a few good 
ideas on how to do this. Ananya's article[^2] on dev.to was a great starting point, especially since most other articles
don't suggest CSS custom properties (also called variables) for implementing dark mode. 

The most common approach seems to be defining an alternative dark mode global `<body>` class and using Javascript 
before the body renders to edit its class to the dark mode explicitly. Since Lumen already makes use of Sass, I went 
with a mixed approach, keeping Sass variables in the different components and assigning to them the CSS custom 
properties. 

This has its drawbacks too, as we can't use Sass color module functions, but the very limited number of colors and page
types of the template allows for pre-setting all the colors we will use.




[^1]:
    The code is still available under the [gh-page-staticjinja-based](https://github.com/joaommartins/joaommartins.github.io/tree/gh-page-staticjinja-based) branch backing this repo.

[^2]:
    [Article](https://dev.to/ananyaneogi/create-a-dark-light-mode-switch-with-css-variables-34l8) by Ananya Neogi.