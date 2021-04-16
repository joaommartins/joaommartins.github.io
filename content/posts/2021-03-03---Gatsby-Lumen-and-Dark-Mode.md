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
types of the template allows for pre-setting all the colors we will use. It also has its benefits, since we can 
directly use [CSS attribute selectors](https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors) and 
HMTL5's [data-* global attributes](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/data-*). We can 
use an attribute selector dependent on our data-* attribute, changing the color variables depending on which `theme` 
data attribute we select.

## Media queries and setting a mode
> Media Queries allow authors to test and query values or features of the user agent or display device, independent of
> the document being rendered. They are used in the CSS @media rule to conditionally apply styles to a document, and in
> various other contexts and languages, such as HTML and JavaScript.
>
> — [Media Queries Level 5 specification](https://drafts.csswg.org/mediaqueries-5/#prefers-color-scheme)

We're connecting another recent feature of CSS formatting, media queries and, more specifically, the `prefers-color-scheme`
media query that informs the browser of the client's OS dark/light mode preference. With this I can infer the reader's
preference for a dark or light mode and use that preference to style the page accordingly. 

```javascript
const mql = window.matchMedia('(prefers-color-scheme: dark)');
const hasMediaQueryPreference = typeof mql.matches === 'boolean';
if (hasMediaQueryPreference && mql.matches === true) {
  document.documentElement.dataset.theme = 'dark';
} else {
  document.documentElement.dataset.theme = 'light'
}
```

`mql` should hold a boolean, indicating if the user's OS color preference is dark mode. Like I mentioned before, I'm 
using data-* attributes, which means that we can use the `dataset` object of `documentElement`. Subsequently, I set my 
alternative CSS selector to use these data-* attribute:

```sass
// Colors, using css variables
:root {
  // Based on One Light: https://github.com/atom/one-light-syntax/blob/master/styles/colors.less
  --bg-color: rgb(231, 230, 223);

  --base: rgb(11, 23, 82);
  --primary: rgb(134, 69, 28);
  --secondary: rgba(11, 23, 82, 70%);
  --gray: hsl(230, 23%, 23%);
  --gray-border: hsl(230, 77%, 13%);
}

[data-theme="dark"] {
  // Based on One Dark: https://github.com/atom/atom/blob/master/packages/one-dark-syntax/styles/colors.less
  --bg-color: hsl(220, 13%, 18%);

  --base: hsl(219, 14%, 71%); // mono-1
  --primary: hsl( 29, 54%, 61%); // orange-1
  --secondary: hsl(220, 9%, 55%); // mono-2
  --gray-border: hsl(220, 10%, 40%); // mono-3
  --gray: hsl(0, 0%, 100%); // white
}
```

As discussed before, depending on the root data attribute, the page will either display the default CSS colors or the 
dark mode colors.


## Flash of Unstyled Content
The [flash of unstyled content \(FOUC\)](https://web.archive.org/web/20150513055019/http://www.bluerobot.com/web/css/fouc.asp/) 
is a fairly annoying consequence of sequential DOM building, where a browser will display 
HTML without having fully loaded its CSS. It is especially noticeable on dark/light mode pages when the default flashing 
page mode is different from the expected OS color mode, and getting around this issue is fairly easy with Gatsby.



[^1]:
    The code is still available under the [gh-page-staticjinja-based](https://github.com/joaommartins/joaommartins.github.io/tree/gh-page-staticjinja-based) branch backing this repo.

[^2]:
    [Article](https://dev.to/ananyaneogi/create-a-dark-light-mode-switch-with-css-variables-34l8) by Ananya Neogi.