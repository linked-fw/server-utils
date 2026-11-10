import React, { Fragment } from 'react';
import { Html } from './Html.js';
import { Body } from './Body.js';
import { Head } from './Head.js';
import { useAppContext } from './AppContext.js';

function isReactElement(arg: any): arg is React.ReactElement {
  return arg.hasOwnProperty('type');
}

export const AppRoot = React.memo<{ style?: any } & React.PropsWithChildren>(
  ({ children, style }) => {
    let { isNativeApp } = useAppContext();
    //find the Head and Body child components
    const childrenArray = React.Children.toArray(children);
    const HeadChild = childrenArray.find(
      (child) => isReactElement(child) && child.type === Head
    );
    let bodyChild: any = childrenArray.find(
      (child) => isReactElement(child) && child.type === Body
    );

    //if no <Body> tag was used, then we just render all children
    if (!bodyChild) {
      //remove HeadChild if any
      if (HeadChild) {
        childrenArray.splice(childrenArray.indexOf(HeadChild), 1);
      }
      bodyChild = childrenArray;
    }

    //for the app, we already have a fixed index file under web, so we just render the body
    // with the same providers and props though
    let RootElement;
    let rootProps;
    if (isNativeApp) {
      //for native apps, we already render <html> in the static html file and we just render into the body
      RootElement = Fragment;
    } else {
      //for web apps, we render everything, including the <html> tag
      RootElement = Html;
      rootProps = {
        customHead: HeadChild,
        style,
      };
    }

    return <RootElement {...rootProps}>{bodyChild}</RootElement>;
  }
);
